import { Database as DatabaseCtor } from "../native/load-better-sqlite3.mjs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./memory-schema.mjs";
import {
  isNameGroundingStatus,
  isNameProfileKey,
  isProfileFactPromptVisible
} from "./profile-name-keys.mjs";
import {
  assertProfileMaxEntries,
  ProfileEvictor
} from "./profile-eviction.mjs";
const PROFILE_VALUE_MAX_LENGTH = 2e3;
const PROFILE_KEY_MAX_LENGTH = 120;
const PROFILE_KEYWORDS_MAX = 8;
const PROFILE_KEYWORD_MAX_LENGTH = 40;
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/;
class ProfileStore {
  db;
  metrics;
  evictor;
  onEvicted;
  insertStmt;
  markSupersededStmt;
  preflipParentStmt;
  selectActiveByKeyStmt;
  selectActiveByIdStmt;
  selectAllActiveStmt;
  historyByKeyStmt;
  deleteActiveStmt;
  markNameGroundingStmt;
  markUnconfirmedNameGroundingStmt;
  constructor(options) {
    if (options.maxEntries !== void 0) {
      assertProfileMaxEntries(options.maxEntries);
    }
    mkdirSync(dirname(options.dbFile), { recursive: true });
    this.db = new DatabaseCtor(options.dbFile);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    applyMigrations(this.db);
    this.metrics = options.metrics;
    this.evictor = options.maxEntries !== void 0 ? new ProfileEvictor(this.db, options.maxEntries) : null;
    this.onEvicted = options.onEvicted;
    this.insertStmt = this.db.prepare(
      `INSERT INTO profile_facts
         (key, value, pinned, keywords, valid_from, superseded_by,
          supersedes, created_at, updated_at, name_grounding,
          name_checked_at)
       VALUES
         (@key, @value, @pinned, @keywords, @valid_from, NULL,
          @supersedes, @created_at, @updated_at, @name_grounding,
          @name_checked_at)`
    );
    this.markSupersededStmt = this.db.prepare(
      `UPDATE profile_facts
          SET superseded_by = @new_id,
              updated_at = @now
        WHERE id = @id`
    );
    this.preflipParentStmt = this.db.prepare(
      `UPDATE profile_facts
          SET superseded_by = id
        WHERE id = ?`
    );
    this.selectActiveByKeyStmt = this.db.prepare(
      `SELECT id, key, value, pinned, keywords, valid_from,
              superseded_by, supersedes, created_at, updated_at,
              vote_score, name_grounding, name_checked_at
         FROM profile_facts
        WHERE key = ? AND superseded_by IS NULL`
    );
    this.selectActiveByIdStmt = this.db.prepare(
      `SELECT id, key, value, pinned, keywords, valid_from,
              superseded_by, supersedes, created_at, updated_at,
              vote_score, name_grounding, name_checked_at
         FROM profile_facts
        WHERE id = ?`
    );
    this.selectAllActiveStmt = this.db.prepare(
      `SELECT id, key, value, pinned, keywords, valid_from,
              superseded_by, supersedes, created_at, updated_at,
              vote_score, name_grounding, name_checked_at
         FROM profile_facts
        WHERE superseded_by IS NULL
        ORDER BY key ASC`
    );
    this.historyByKeyStmt = this.db.prepare(
      `SELECT id, key, value, pinned, keywords, valid_from,
              superseded_by, supersedes, created_at, updated_at,
              vote_score, name_grounding, name_checked_at
         FROM profile_facts
        WHERE key = ?
        ORDER BY valid_from ASC, id ASC`
    );
    this.deleteActiveStmt = this.db.prepare(
      `DELETE FROM profile_facts
        WHERE key = ? AND superseded_by IS NULL`
    );
    this.markNameGroundingStmt = this.db.prepare(
      `UPDATE profile_facts
          SET name_grounding = @status,
              name_checked_at = @now
        WHERE id = @id`
    );
    this.markUnconfirmedNameGroundingStmt = this.db.prepare(
      `UPDATE profile_facts
          SET name_grounding = @status,
              name_checked_at = @now
        WHERE id = @id
          AND (name_grounding IS NULL OR name_grounding = 'ungrounded')`
    );
  }
  /**
   * Write a new version of a profile fact. Every call inserts a
   * **new row**; the previous active row for the same key (and the
   * `supersedesKey`, if provided) is marked superseded in the same
   * transaction. The transaction guarantees the partial unique index
   * never sees two active rows for a key at the same instant.
   *
   * The legacy 3-arg form `set(key, value, now)` is preserved for
   * back-compat with the reflection runner and assorted tests.
   */
  set(key, value, optionsOrNow, nowArg) {
    const normalisedKey = validateKey(key);
    const normalisedValue = validateValue(value);
    const options = typeof optionsOrNow === "object" && optionsOrNow !== null ? optionsOrNow : {};
    const now = typeof optionsOrNow === "number" ? optionsOrNow : nowArg ?? Date.now();
    const pinned = options.pinned === void 0 ? true : Boolean(options.pinned);
    const keywords = pinned ? [] : validateKeywords(options.keywords);
    const supersedesKeyRaw = options.supersedesKey;
    const supersedesKey = supersedesKeyRaw !== void 0 ? validateKey(supersedesKeyRaw) : null;
    const nameGrounding = isNameProfileKey(normalisedKey) && options.nameGrounding !== void 0 ? options.nameGrounding : null;
    const txn = this.db.transaction(
      () => {
        const sameKeyActive = this.selectActiveByKeyStmt.get(normalisedKey);
        const crossKeyActive = supersedesKey !== null && supersedesKey !== normalisedKey ? this.selectActiveByKeyStmt.get(supersedesKey) : void 0;
        const directParent = sameKeyActive ?? crossKeyActive ?? null;
        if (sameKeyActive) {
          this.preflipParentStmt.run(sameKeyActive.id);
        }
        if (crossKeyActive && crossKeyActive.id !== (sameKeyActive?.id ?? -1)) {
          this.preflipParentStmt.run(crossKeyActive.id);
        }
        const insertResult = this.insertStmt.run({
          key: normalisedKey,
          value: normalisedValue,
          pinned: pinned ? 1 : 0,
          keywords: keywords.length > 0 ? JSON.stringify(keywords) : null,
          valid_from: now,
          supersedes: directParent ? directParent.id : null,
          created_at: now,
          updated_at: now,
          name_grounding: nameGrounding,
          name_checked_at: nameGrounding !== null ? now : null
        });
        const newId = Number(insertResult.lastInsertRowid);
        if (sameKeyActive) {
          this.markSupersededStmt.run({
            new_id: newId,
            now,
            id: sameKeyActive.id
          });
        }
        if (crossKeyActive && crossKeyActive.id !== (sameKeyActive?.id ?? -1)) {
          this.markSupersededStmt.run({
            new_id: newId,
            now,
            id: crossKeyActive.id
          });
        }
        return {
          id: newId,
          supersedes: directParent ? directParent.id : null,
          // Same transaction as the insert: the cap is never observed
          // exceeded, and a write that rolls back evicts nothing.
          eviction: this.evictor?.evictOverflow(newId) ?? null
        };
      }
    );
    const { id, supersedes, eviction } = txn();
    if (eviction !== null) {
      try {
        this.onEvicted?.(eviction);
      } catch {
      }
    }
    if (supersedes !== null) {
      this.metrics?.recordProfileSuperseded({
        key: normalisedKey,
        previousId: supersedes,
        nextId: id
      });
    }
    return {
      id,
      key: normalisedKey,
      value: normalisedValue,
      validFrom: now,
      updatedAt: now,
      pinned,
      keywords,
      supersedes,
      supersededBy: null,
      voteScore: 0,
      nameGrounding
    };
  }
  /**
   * Delete the **active** row for `key`. Historical (superseded)
   * rows are kept on disk — direct chain walks via `history(key)`
   * still work. Returns `true` when a row was deleted.
   */
  remove(key) {
    const normalisedKey = validateKey(key);
    const result = this.deleteActiveStmt.run(normalisedKey);
    return result.changes > 0;
  }
  /**
   * Return the active row for `key`, or `null` when no active row
   * exists (either never written, or the active row was removed).
   * Superseded rows are never returned here.
   */
  get(key) {
    const normalisedKey = validateKey(key);
    const row = this.selectActiveByKeyStmt.get(normalisedKey);
    if (!row) return null;
    return rowToFact(row);
  }
  /**
   * Return the row with the given `id` regardless of supersession
   * status. Useful for traversing historical chains and for the
   * `memory.profile.history` tool's pretty-printer.
   */
  getById(id) {
    const row = this.selectActiveByIdStmt.get(id);
    return row ? rowToFact(row) : null;
  }
  /**
   * List every **active** profile fact, ordered by `key ASC`. This
   * is the surface used by the prompt renderer and the live profile
   * snapshot in `agent-loop`.
   */
  list() {
    const rows = this.selectAllActiveStmt.all();
    return rows.map(rowToFact);
  }
  /**
   * ATO-199. The active facts the prompt may carry: `list()` without
   * the name-like facts no check has vouched for (an invented name, or
   * one not checked yet). They stay on disk and in `list()` — listings
   * show them marked so the user can confirm or remove them — but the
   * agent never addresses the user by them, and nothing downstream of
   * the prompt (votes, reflection) treats them as known.
   */
  listForPrompt() {
    return this.list().filter(isProfileFactPromptVisible);
  }
  /**
   * ATO-199. Active name-like facts the startup check has to look at:
   * never checked, or checked and found `ungrounded` (re-checked against
   * the sessions written since, in case the user has said it by now).
   */
  listNameFactsToCheck() {
    const rows = this.selectAllActiveStmt.all();
    const out = [];
    for (const row of rows) {
      if (!isNameProfileKey(row.key)) continue;
      const fact = rowToFact(row);
      if (fact.nameGrounding === null) {
        out.push({ fact, checkedAt: null });
      } else if (fact.nameGrounding === "ungrounded") {
        out.push({ fact, checkedAt: row.name_checked_at });
      }
    }
    return out;
  }
  /**
   * ATO-199. Record a grounding verdict on one row. No-op (returns
   * `false`) for a row that is gone or whose key is not name-like.
   * `ifUnconfirmed` writes only over "not checked yet" or `ungrounded`:
   * the startup check, whose walk yields, must not undo a confirmation
   * `memory.profile.set` or reflection recorded while it ran.
   */
  markNameGrounding(id, status, now = Date.now(), options = {}) {
    const row = this.selectActiveByIdStmt.get(id);
    if (!row || !isNameProfileKey(row.key)) return false;
    const stmt = options.ifUnconfirmed ? this.markUnconfirmedNameGroundingStmt : this.markNameGroundingStmt;
    const result = stmt.run({ id, status, now });
    return result.changes > 0;
  }
  /**
   * Memory-v2 phase 4. Walk the full bi-temporal chain for `key` in
   * temporal order (oldest first). Includes both superseded and
   * active rows. The active row (if any) is the last entry. Returns
   * `[]` when the key has no history.
   *
   * Cross-key supersession (e.g. `name` → `full_name`) is **not**
   * traversed here — `history` is per-key by design so the rendered
   * timeline matches the column header the user sees in
   * `### profile`. For cross-key walks, follow `supersededBy` /
   * `supersedes` pointers via `getById`.
   */
  history(key) {
    const normalisedKey = validateKey(key);
    const rows = this.historyByKeyStmt.all(normalisedKey);
    return rows.map(rowToFact);
  }
  close() {
    this.db.close();
  }
}
class ProfileValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = "ProfileValidationError";
  }
}
function rowToFact(row) {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    validFrom: row.valid_from,
    updatedAt: row.updated_at,
    pinned: row.pinned !== 0,
    keywords: parseKeywords(row.keywords),
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    voteScore: row.vote_score ?? 0,
    // Anything but a known verdict — a value some later build wrote, a
    // non-name key — reads as unchecked.
    nameGrounding: isNameProfileKey(row.key) && isNameGroundingStatus(row.name_grounding) ? row.name_grounding : null
  };
}
function parseKeywords(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((k) => typeof k === "string");
    }
  } catch {
  }
  return [];
}
function validateKey(raw) {
  if (typeof raw !== "string") {
    throw new ProfileValidationError("key", "profile key must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ProfileValidationError("key", "profile key must be non-empty");
  }
  if (trimmed.length > PROFILE_KEY_MAX_LENGTH) {
    throw new ProfileValidationError(
      "key",
      `profile key must be at most ${PROFILE_KEY_MAX_LENGTH} chars`
    );
  }
  if (!KEY_PATTERN.test(trimmed)) {
    throw new ProfileValidationError(
      "key",
      "profile key must start with alphanumeric and contain only [a-zA-Z0-9_.-]"
    );
  }
  return trimmed;
}
function validateValue(raw) {
  if (typeof raw !== "string") {
    throw new ProfileValidationError("value", "profile value must be a string");
  }
  if (raw.length === 0) {
    throw new ProfileValidationError(
      "value",
      "profile value must be non-empty"
    );
  }
  if (raw.length > PROFILE_VALUE_MAX_LENGTH) {
    throw new ProfileValidationError(
      "value",
      `profile value must be at most ${PROFILE_VALUE_MAX_LENGTH} chars`
    );
  }
  return raw;
}
function validateKeywords(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ProfileValidationError(
      "keywords",
      "keywords must be a string array"
    );
  }
  if (raw.length > PROFILE_KEYWORDS_MAX) {
    throw new ProfileValidationError(
      "keywords",
      `keywords must contain at most ${PROFILE_KEYWORDS_MAX} entries`
    );
  }
  const normalised = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (typeof entry !== "string") {
      throw new ProfileValidationError(
        "keywords",
        `keywords[${i}] must be a string`
      );
    }
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length === 0) {
      throw new ProfileValidationError(
        "keywords",
        `keywords[${i}] must be non-empty`
      );
    }
    if (trimmed.length > PROFILE_KEYWORD_MAX_LENGTH) {
      throw new ProfileValidationError(
        "keywords",
        `keywords[${i}] must be at most ${PROFILE_KEYWORD_MAX_LENGTH} chars`
      );
    }
    if (!normalised.includes(trimmed)) normalised.push(trimmed);
  }
  return normalised;
}
export {
  PROFILE_KEYWORDS_MAX,
  PROFILE_KEYWORD_MAX_LENGTH,
  PROFILE_KEY_MAX_LENGTH,
  PROFILE_VALUE_MAX_LENGTH,
  ProfileStore,
  ProfileValidationError
};
