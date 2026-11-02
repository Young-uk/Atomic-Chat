import { Database as DatabaseCtor } from "../../native/load-better-sqlite3.mjs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "../memory-schema.mjs";
const LESSON_ACTIVATION_MAX_LENGTH = 240;
const LESSON_PRINCIPLE_MAX_LENGTH = 800;
const LESSON_MAX_TAGS = 12;
const LESSON_TAG_MAX_LENGTH = 40;
const LESSON_RECALL_DEFAULT_K = 2;
const LESSON_RECALL_MAX_K = 10;
const LESSON_INDEX_DEFAULT_LIMIT = 20;
const LESSON_INDEX_MAX_LIMIT = 100;
const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,39}$/;
class LessonValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = "LessonValidationError";
  }
}
class LessonStore {
  db;
  metrics;
  maxEntries;
  clock;
  insertStmt;
  getByIdStmt;
  listActiveStmt;
  recallActiveStmt;
  recallAnyStmt;
  markDeprecatedStmt;
  bumpSuccessStmt;
  bumpFailureStmt;
  countActiveStmt;
  countAllStmt;
  constructor(options) {
    mkdirSync(dirname(options.dbFile), { recursive: true });
    this.db = new DatabaseCtor(options.dbFile);
    this.db.pragma("journal_mode = WAL");
    applyMigrations(this.db);
    this.metrics = options.metrics;
    this.maxEntries = options.maxEntries;
    this.clock = options.now ?? Date.now;
    this.insertStmt = this.db.prepare(
      `INSERT INTO lessons (
         activation, principle, tags, status,
         success_count, failure_count, parent_ids,
         working_dir, created_at, updated_at, deprecated_at)
       VALUES (@activation, @principle, @tags, 'active',
               0, 0, @parent_ids,
               @working_dir, @now, @now, NULL)`
    );
    this.getByIdStmt = this.db.prepare(
      `SELECT id, activation, principle, tags, status,
              success_count, failure_count, parent_ids,
              working_dir, created_at, updated_at, deprecated_at,
              vote_score
         FROM lessons
        WHERE id = ?`
    );
    this.listActiveStmt = this.db.prepare(
      `SELECT id, activation, tags, working_dir, updated_at
         FROM lessons
        WHERE status = 'active'
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`
    );
    this.recallActiveStmt = this.db.prepare(
      `SELECT l.id, l.activation, l.principle, l.tags, l.status,
              l.success_count, l.failure_count, l.parent_ids,
              l.working_dir, l.created_at, l.updated_at, l.deprecated_at,
              l.vote_score,
              bm25(lessons_fts) AS score
         FROM lessons_fts
         JOIN lessons l ON l.id = lessons_fts.rowid
        WHERE lessons_fts MATCH ?
          AND l.status = 'active'
        ORDER BY score ASC
        LIMIT ?`
    );
    this.recallAnyStmt = this.db.prepare(
      `SELECT l.id, l.activation, l.principle, l.tags, l.status,
              l.success_count, l.failure_count, l.parent_ids,
              l.working_dir, l.created_at, l.updated_at, l.deprecated_at,
              l.vote_score,
              bm25(lessons_fts) AS score
         FROM lessons_fts
         JOIN lessons l ON l.id = lessons_fts.rowid
        WHERE lessons_fts MATCH ?
        ORDER BY score ASC
        LIMIT ?`
    );
    this.markDeprecatedStmt = this.db.prepare(
      `UPDATE lessons
          SET status = 'deprecated',
              deprecated_at = @now,
              updated_at = @now
        WHERE id = @id AND status = 'active'`
    );
    this.bumpSuccessStmt = this.db.prepare(
      `UPDATE lessons
          SET success_count = success_count + 1,
              updated_at = @now
        WHERE id = @id`
    );
    this.bumpFailureStmt = this.db.prepare(
      `UPDATE lessons
          SET failure_count = failure_count + 1,
              updated_at = @now
        WHERE id = @id`
    );
    this.countActiveStmt = this.db.prepare(
      `SELECT COUNT(*) AS c FROM lessons WHERE status = 'active'`
    );
    this.countAllStmt = this.db.prepare(`SELECT COUNT(*) AS c FROM lessons`);
  }
  /**
   * Insert a new lesson. Validation throws `LessonValidationError`
   * (caller — typically the consolidator — folds these into metrics
   * and never lets them bubble out of the tick).
   */
  create(input) {
    const activation = validateActivation(input.activation);
    const principle = validatePrinciple(input.principle);
    const tags = validateTags(input.tags);
    const parentIds = validateParentIds(input.parentIds);
    const workingDir = input.workingDir === null || input.workingDir === void 0 || input.workingDir === "" ? null : String(input.workingDir);
    const now = this.clock();
    const result = this.insertStmt.run({
      activation,
      principle,
      tags: tags.length > 0 ? JSON.stringify(tags) : null,
      parent_ids: JSON.stringify(parentIds),
      working_dir: workingDir,
      now
    });
    const id = Number(result.lastInsertRowid);
    this.metrics?.recordLessonCreated({
      lessonId: id,
      parentCount: parentIds.length
    });
    return {
      id,
      activation,
      principle,
      tags,
      status: "active",
      successCount: 0,
      failureCount: 0,
      parentIds: [...parentIds],
      workingDir,
      createdAt: now,
      updatedAt: now,
      deprecatedAt: null,
      voteScore: 0
    };
  }
  /**
   * Direct id lookup. Returns `null` for missing ids. Reads
   * **regardless of `status`** so postmortems / audits can still
   * walk back from a parent's `consolidated_into` pointer even
   * after the lesson is deprecated.
   */
  getById(id) {
    const normalised = validateLessonId(id);
    const row = this.getByIdStmt.get(normalised);
    if (!row) return null;
    return rowToLesson(row);
  }
  /**
   * BM25 recall over `lessons_fts` (activation + principle + tags).
   * Defaults to `active` lessons only; pass `includeDeprecated=true`
   * to widen the search. Empty / blank query returns `[]` — callers
   * should use `listIndex` for the recent-items view.
   */
  recall(opts = {}) {
    if (opts.id !== void 0) {
      const lesson = this.getById(opts.id);
      return lesson ? [lesson] : [];
    }
    const rawQuery = (opts.query ?? "").trim();
    if (rawQuery.length === 0) return [];
    if (rawQuery.length > 500) {
      throw new LessonValidationError(
        "query",
        "lesson recall query must be at most 500 chars"
      );
    }
    const k = clampPositiveInt(
      opts.k ?? LESSON_RECALL_DEFAULT_K,
      1,
      LESSON_RECALL_MAX_K
    );
    const ftsQuery = buildFtsQuery(rawQuery);
    if (ftsQuery === null) return [];
    const stmt = opts.includeDeprecated ? this.recallAnyStmt : this.recallActiveStmt;
    if (typeof opts.scoreBlend === "number") {
      const blend = Math.max(0, Math.min(1, opts.scoreBlend));
      const poolMultiplier = Math.max(
        1,
        Math.min(5, Math.floor(opts.rerankPoolMultiplier ?? 3))
      );
      const pool = Math.max(k, k * poolMultiplier);
      const rows2 = stmt.all(ftsQuery, pool);
      const lessons = rows2.map(rowToLesson);
      const indexed = lessons.map((lesson, idx) => ({
        lesson,
        bm25Rank: idx,
        combined: computeLessonCombinedScore(lesson, blend)
      }));
      indexed.sort((a, b) => {
        if (a.combined !== b.combined) return b.combined - a.combined;
        return a.bm25Rank - b.bm25Rank;
      });
      return indexed.slice(0, k).map((entry) => entry.lesson);
    }
    const rows = stmt.all(ftsQuery, k);
    return rows.map(rowToLesson);
  }
  /**
   * Compact pointer view over recent `active` lessons. Returns the
   * `activation` (not `principle`) plus tags + working_dir so the
   * `### lessons` renderer can produce one-line pointer rows
   * without leaking the full body. Full body is gated behind
   * `memory.lessons.recall { id }`.
   */
  listIndex(opts = {}) {
    const limit = clampPositiveInt(
      opts.limit ?? LESSON_INDEX_DEFAULT_LIMIT,
      1,
      LESSON_INDEX_MAX_LIMIT
    );
    const rows = this.listActiveStmt.all(limit);
    return rows.map((r) => ({
      id: r.id,
      activation: r.activation,
      tags: parseTags(r.tags),
      workingDir: r.working_dir,
      updatedAt: r.updated_at
    }));
  }
  /**
   * Demote an `active` lesson to `deprecated`. Idempotent — calling
   * twice on the same id does nothing on the second call. Returns
   * `true` when the row actually flipped. Phase 6 owns lifecycle
   * decisions; phase 5 exposes the primitive.
   */
  markDeprecated(id, reason) {
    const normalised = validateLessonId(id);
    const now = this.clock();
    const r = this.markDeprecatedStmt.run({
      id: normalised,
      now
    });
    if (r.changes > 0) {
      this.metrics?.recordLessonDeprecated({
        lessonId: normalised,
        reason: reason ?? "unspecified"
      });
      return true;
    }
    return false;
  }
  /** Phase 6 hook. Idempotent counter bump. */
  bumpSuccess(id) {
    const normalised = validateLessonId(id);
    const now = this.clock();
    const r = this.bumpSuccessStmt.run({ id: normalised, now });
    return r.changes > 0;
  }
  /** Phase 6 hook. Idempotent counter bump. */
  bumpFailure(id) {
    const normalised = validateLessonId(id);
    const now = this.clock();
    const r = this.bumpFailureStmt.run({ id: normalised, now });
    return r.changes > 0;
  }
  /** Total active lessons. */
  countActive() {
    return this.countActiveStmt.get().c;
  }
  /** Total lessons regardless of status. */
  countAll() {
    return this.countAllStmt.get().c;
  }
  /**
   * Phase 6 — age-based deprecation predicate.
   *
   * Returns ids of **active** lessons whose `success_count == 0` AND
   * `created_at <= now - deprecationAgeMs`. The "still unused"
   * predicate is the load-bearing filter: a lesson that has helped at
   * least one turn (`success_count >= 1`) survives indefinitely
   * regardless of age — only the FIFO `pickOverflowForDeprecation`
   * sweep can demote it. Failure-count is **not** part of the
   * predicate; phase 7a will combine `vote_score < 0` with age. The
   * `limit` is a defensive cap (default `1000`) so a runaway tick
   * cannot burn the SQLite handle scanning millions of rows.
   *
   * Pinned by `lesson-store.test.ts` ("age picker filters by
   * success_count and creation time").
   */
  pickAgeDeprecationCandidates(args) {
    const threshold = args.now - Math.max(0, args.deprecationAgeMs);
    const limit = Math.max(0, args.limit ?? 1e3);
    if (limit === 0) return [];
    const rows = this.db.prepare(
      `SELECT id FROM lessons
           WHERE status = 'active'
             AND success_count = 0
             AND created_at <= ?
           ORDER BY created_at ASC, id ASC
           LIMIT ?`
    ).all(threshold, limit);
    return rows.map((r) => r.id);
  }
  /**
   * Phase 7a — vote-based deprecation predicate (scorecard 7a.A).
   *
   * Returns ids of **active** lessons whose `vote_score < 0` AND
   * `success_count == 0`. A lesson that the operator has actively
   * downvoted before it ever helped a turn is treated as
   * disqualified — `pickAgeDeprecationCandidates` would have waited
   * the full `deprecationAgeMs` (30 days by default), this predicate
   * promotes them immediately at the next consolidator tick.
   *
   * `success_count == 0` is load-bearing: a lesson that has
   * accumulated success bumps from previous turns survives even a
   * net-negative vote signal, since the automatic feedback channel
   * is harder to game than ad-hoc voting. Operators who want to
   * forcibly retire a successful lesson use `markDeprecated`
   * directly.
   *
   * Ordering: most-negative votes first so the highest-confidence
   * "this is bad" signals get retired before borderline cases when
   * the tick cap (`maxDeprecationsPerTick`) binds.
   */
  pickVoteDeprecationCandidates(args = {}) {
    const limit = Math.max(0, args.limit ?? 1e3);
    if (limit === 0) return [];
    const rows = this.db.prepare(
      `SELECT id FROM lessons
           WHERE status = 'active'
             AND success_count = 0
             AND vote_score < 0
           ORDER BY vote_score ASC, created_at ASC, id ASC
           LIMIT ?`
    ).all(limit);
    return rows.map((r) => r.id);
  }
  /**
   * Hard-cap helper. Returns the ids of lessons that should be
   * demoted to honour `maxEntries`. Caller decides whether to
   * flip them via `markDeprecated`. Returns `[]` when below the
   * cap. Phase 6 wires this on every consolidator tick; phase 5
   * leaves it dormant.
   */
  pickOverflowForDeprecation() {
    if (this.maxEntries === void 0) return [];
    const active = this.countActive();
    if (active <= this.maxEntries) return [];
    const overflow = active - this.maxEntries;
    const rows = this.db.prepare(
      `SELECT id FROM lessons
           WHERE status = 'active'
           ORDER BY updated_at ASC, id ASC
           LIMIT ?`
    ).all(overflow);
    return rows.map((r) => r.id);
  }
  close() {
    this.db.close();
  }
}
function rowToLesson(row) {
  return {
    id: row.id,
    activation: row.activation,
    principle: row.principle,
    tags: parseTags(row.tags),
    status: row.status === "deprecated" ? "deprecated" : "active",
    successCount: row.success_count,
    failureCount: row.failure_count,
    parentIds: parseParentIds(row.parent_ids),
    workingDir: row.working_dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deprecatedAt: row.deprecated_at,
    voteScore: typeof row.vote_score === "number" ? row.vote_score : 0
  };
}
function computeLessonCombinedScore(lesson, scoreBlend) {
  const blend = Math.max(0, Math.min(1, scoreBlend));
  return blend * lesson.voteScore + (1 - blend) * (lesson.successCount - lesson.failureCount);
}
function parseTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t) => typeof t === "string");
    }
  } catch {
  }
  return [];
}
function parseParentIds(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
    }
  } catch {
  }
  return [];
}
function validateActivation(raw) {
  if (typeof raw !== "string") {
    throw new LessonValidationError(
      "activation",
      "activation must be a string"
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LessonValidationError(
      "activation",
      "activation must be non-empty"
    );
  }
  if (trimmed.length > LESSON_ACTIVATION_MAX_LENGTH) {
    throw new LessonValidationError(
      "activation",
      `activation must be at most ${LESSON_ACTIVATION_MAX_LENGTH} chars`
    );
  }
  return trimmed;
}
function validatePrinciple(raw) {
  if (typeof raw !== "string") {
    throw new LessonValidationError("principle", "principle must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new LessonValidationError("principle", "principle must be non-empty");
  }
  if (trimmed.length > LESSON_PRINCIPLE_MAX_LENGTH) {
    throw new LessonValidationError(
      "principle",
      `principle must be at most ${LESSON_PRINCIPLE_MAX_LENGTH} chars`
    );
  }
  return trimmed;
}
function validateTags(raw) {
  if (raw === void 0) return [];
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (trimmed.length > LESSON_TAG_MAX_LENGTH) continue;
    if (!TAG_PATTERN.test(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= LESSON_MAX_TAGS) break;
  }
  return out;
}
function validateParentIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new LessonValidationError(
      "parentIds",
      "parentIds must contain at least one episode id"
    );
  }
  const out = [];
  for (const id of raw) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new LessonValidationError(
        "parentIds",
        "every parentIds entry must be a positive integer"
      );
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
function validateLessonId(raw) {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new LessonValidationError(
      "id",
      "lesson id must be a positive integer"
    );
  }
  return raw;
}
function clampPositiveInt(raw, lo, hi) {
  if (!Number.isFinite(raw)) return lo;
  const n = Math.floor(raw);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
function buildFtsQuery(raw) {
  const tokens = raw.split(/[^\p{L}\p{N}]+/u).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}
export {
  LESSON_ACTIVATION_MAX_LENGTH,
  LESSON_INDEX_DEFAULT_LIMIT,
  LESSON_INDEX_MAX_LIMIT,
  LESSON_MAX_TAGS,
  LESSON_PRINCIPLE_MAX_LENGTH,
  LESSON_RECALL_DEFAULT_K,
  LESSON_RECALL_MAX_K,
  LESSON_TAG_MAX_LENGTH,
  LessonStore,
  LessonValidationError,
  computeLessonCombinedScore
};
