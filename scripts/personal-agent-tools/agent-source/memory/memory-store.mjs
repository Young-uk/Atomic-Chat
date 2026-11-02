import { Database as DatabaseCtor } from "../native/load-better-sqlite3.mjs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./memory-schema.mjs";
import {
  recallHybrid
} from "./embeddings/hybrid-recall.mjs";
const DEFAULT_BRUTE_FORCE_CEILING = 2e3;
const MEMORY_CONTENT_MAX_LENGTH = 4e3;
const MEMORY_TAG_MAX_LENGTH = 40;
const MEMORY_MAX_TAGS = 16;
const MEMORY_QUERY_MAX_LENGTH = 500;
const MEMORY_RECALL_DEFAULT_K = 5;
const MEMORY_RECALL_MAX_K = 50;
const MEMORY_LIST_MAX_LIMIT = 200;
const MEMORY_INDEX_PREVIEW_CHARS_DEFAULT = 80;
const MEMORY_INDEX_PREVIEW_CHARS_MAX = 400;
class MemoryStore {
  db;
  maxEntries;
  dedupEnabled;
  dedupThreshold;
  evictionUtilityWeighted;
  metrics;
  embeddingWriter;
  embeddingStore;
  // Set at construction or by `attachEmbeddings` (the runtime attaches
  // after its embedding probe, with the configured values).
  embeddingFts5Weight;
  embeddingVectorWeight;
  embeddingBruteForceCeiling;
  embeddingMinCosine;
  now;
  insertStmt;
  deleteStmt;
  getStmt;
  countStmt;
  hasContentStmt;
  evictFifoStmt;
  evictUtilityStmt;
  touchOnDedupStmt;
  recallTouchStmt;
  dedupCandidateStmt;
  constructor(options) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error(
        `MemoryStore: maxEntries must be a positive integer, got ${options.maxEntries}`
      );
    }
    const dedupThreshold = options.dedup?.fts5Threshold ?? 0.85;
    if (!Number.isFinite(dedupThreshold) || dedupThreshold < 0 || dedupThreshold > 1) {
      throw new Error(
        `MemoryStore: dedup.fts5Threshold must be in [0, 1], got ${dedupThreshold}`
      );
    }
    mkdirSync(dirname(options.dbFile), { recursive: true });
    this.db = new DatabaseCtor(options.dbFile);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    applyMigrations(this.db);
    this.maxEntries = options.maxEntries;
    this.dedupEnabled = options.dedup?.enabled ?? false;
    this.dedupThreshold = dedupThreshold;
    this.evictionUtilityWeighted = options.eviction?.utilityWeighted ?? false;
    this.metrics = options.metrics;
    this.embeddingWriter = options.embeddings?.writer;
    this.embeddingStore = options.embeddings?.store;
    this.embeddingFts5Weight = options.embeddings?.fts5Weight ?? 0.5;
    this.embeddingVectorWeight = options.embeddings?.vectorWeight ?? 0.5;
    this.embeddingBruteForceCeiling = options.embeddings?.bruteForceCeiling ?? DEFAULT_BRUTE_FORCE_CEILING;
    this.now = options.now ?? Date.now;
    this.insertStmt = this.db.prepare(
      `INSERT INTO memories
         (content, created_at, updated_at, source, session_id, working_dir, tags,
          recall_count, last_recalled_at, consolidating_at)
       VALUES
         (@content, @created_at, @updated_at, @source, @session_id, @working_dir, @tags,
          0, NULL, NULL)`
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    this.getStmt = this.db.prepare(
      `SELECT id, content, created_at, updated_at, source, session_id, working_dir, tags,
              recall_count, last_recalled_at
         FROM memories WHERE id = ?`
    );
    this.countStmt = this.db.prepare(`SELECT COUNT(*) AS count FROM memories`);
    this.hasContentStmt = this.db.prepare(
      `SELECT 1 AS present FROM memories WHERE content = ? LIMIT 1`
    );
    this.evictFifoStmt = this.db.prepare(
      `DELETE FROM memories WHERE id IN (
         SELECT id FROM memories ORDER BY updated_at ASC, id ASC LIMIT ?
       )`
    );
    this.evictUtilityStmt = this.db.prepare(
      `DELETE FROM memories WHERE id IN (
         SELECT id FROM memories
          ORDER BY vote_score ASC,
                   recall_count ASC,
                   COALESCE(last_recalled_at, 0) ASC,
                   updated_at ASC,
                   id ASC
          LIMIT ?
       )`
    );
    this.touchOnDedupStmt = this.db.prepare(
      `UPDATE memories
          SET updated_at = @updated_at,
              tags = @tags,
              recall_count = recall_count + 1
        WHERE id = @id`
    );
    this.recallTouchStmt = this.db.prepare(
      `UPDATE memories
          SET recall_count = recall_count + 1,
              last_recalled_at = @now
        WHERE id = @id`
    );
    this.dedupCandidateStmt = this.db.prepare(
      `SELECT m.id, m.content, m.tags, bm25(memories_fts) AS score
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY score ASC
        LIMIT 5`
    );
  }
  /**
   * Persist a new freeform memory.
   *
   * Memory-v2 phase 1A: when `dedup.enabled` was passed to the
   * constructor, this method first queries FTS5 for up to 5 candidate
   * neighbours and computes Jaccard similarity over normalised content
   * tokens in JS. If the best score clears `dedup.fts5Threshold` and
   * the candidate's tag set is a superset of the new entry's, the
   * existing row absorbs the write (touch `updated_at`, bump
   * `recall_count`, merge tags as new ∪ existing) and `store` returns
   * that existing row instead of inserting. This is the load-bearing
   * guard against a chatty reflection flooding the corpus with
   * paraphrases of the same observation.
   *
   * After a new INSERT, evicts overflow rows. The eviction predicate
   * depends on `eviction.utilityWeighted`:
   *   - `false` (back-compat): oldest by `updated_at` first.
   *   - `true`: 3-tier priority `recall_count ASC,
   *     COALESCE(last_recalled_at, 0) ASC, updated_at ASC` so old but
   *     frequently-recalled rows survive.
   */
  store(input, now = this.now()) {
    const content = validateContent(input.content);
    const tags = validateTags(input.tags);
    const source = validateSource(input.source ?? "agent");
    const sessionId = validateOptionalString(input.sessionId, "sessionId");
    const workingDir = validateOptionalString(input.workingDir, "workingDir");
    if (this.dedupEnabled) {
      const merged = this.tryDedupMerge({ content, tags, now });
      if (merged !== null) return merged;
    } else {
      this.metrics?.recordMemoryDedup({
        outcome: "disabled",
        bestScore: 0,
        candidateId: null
      });
    }
    const tagsJson = tags.length > 0 ? JSON.stringify(tags) : null;
    const result = this.insertStmt.run({
      content,
      created_at: now,
      updated_at: now,
      source,
      session_id: sessionId,
      working_dir: workingDir,
      tags: tagsJson
    });
    const id = Number(result.lastInsertRowid);
    this.evictOverflow();
    if (this.embeddingWriter) {
      void this.embeddingWriter.writeFor(id, content);
    }
    return {
      id,
      content,
      createdAt: now,
      updatedAt: now,
      source,
      sessionId,
      workingDir,
      tags,
      recallCount: 0,
      lastRecalledAt: null
    };
  }
  /**
   * Memory-v2 phase 1B. Async sibling of `store()` that awaits the
   * embedding write before returning. Used by tests and any future
   * caller that wants the just-inserted row to be hybrid-recallable
   * on the very next turn — without this guarantee, there is a
   * (small) race between insert and embed during a fast back-to-back
   * `store ⇒ recall` sequence.
   *
   * Identical semantics to `store()` when embeddings are not attached.
   */
  async storeAsync(input, now = this.now()) {
    const entry = this.store(input, now);
    if (this.embeddingWriter) {
      await this.embeddingWriter.writeFor(entry.id, entry.content);
    }
    return entry;
  }
  /**
   * Pre-insert dedup pipeline. Returns the absorbed row when a merge
   * happened, `null` when no candidate cleared the bar. Always emits
   * exactly one `MemoryDedup` metric sample so the outcome ratio is
   * trustworthy. Single FTS5 query + JS-side similarity — no per-row
   * I/O (cross-phase invariant 5 still holds because the candidate
   * set is at most 5 rows fetched in one statement).
   */
  tryDedupMerge(args) {
    const ftsQuery = buildFtsQuery(args.content);
    if (ftsQuery.length === 0) {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: 0,
        candidateId: null
      });
      return null;
    }
    const tokens = tokeniseForSimilarity(args.content);
    if (tokens.size === 0) {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: 0,
        candidateId: null
      });
      return null;
    }
    let candidates;
    try {
      candidates = this.dedupCandidateStmt.all(ftsQuery);
    } catch {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: 0,
        candidateId: null
      });
      return null;
    }
    let best = null;
    for (const row of candidates) {
      const score = jaccardSimilarity(
        tokens,
        tokeniseForSimilarity(row.content)
      );
      if (best === null || score > best.score) {
        best = { id: row.id, score, row };
      }
    }
    if (best === null) {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: 0,
        candidateId: null
      });
      return null;
    }
    if (best.score < this.dedupThreshold) {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: best.score,
        candidateId: best.id
      });
      return null;
    }
    const existingTags = parseTags(best.row.tags);
    if (!isTagSuperset(existingTags, args.tags)) {
      this.metrics?.recordMemoryDedup({
        outcome: "skipped",
        bestScore: best.score,
        candidateId: best.id
      });
      return null;
    }
    const mergedTags = mergeTagSets(existingTags, args.tags);
    const mergedTagsJson = mergedTags.length > 0 ? JSON.stringify(mergedTags) : null;
    this.touchOnDedupStmt.run({
      id: best.id,
      updated_at: args.now,
      tags: mergedTagsJson
    });
    this.metrics?.recordMemoryDedup({
      outcome: "merged",
      bestScore: best.score,
      candidateId: best.id
    });
    const refreshed = this.get(best.id);
    if (refreshed !== null) return refreshed;
    return null;
  }
  /**
   * BM25-ranked keyword search over `memories_fts`. Returns at most `k`
   * entries (default `MEMORY_RECALL_DEFAULT_K`, hard-capped by
   * `MEMORY_RECALL_MAX_K`). `scope: "project"` restricts to rows whose
   * `working_dir` matches `opts.workingDir`; the caller is responsible
   * for passing the current working directory when they want that
   * filter.
   *
   * When `tags` is given, every requested tag must be present in the
   * row's tag set (AND semantics). Empty / whitespace-only query
   * returns an empty array without a database round-trip.
   */
  recall(query, opts = {}) {
    const normalizedQuery = validateQuery(query);
    const ftsQuery = buildFtsQuery(normalizedQuery);
    if (ftsQuery.length === 0) return [];
    const k = clampPositiveInt(
      opts.k ?? MEMORY_RECALL_DEFAULT_K,
      1,
      MEMORY_RECALL_MAX_K,
      "k"
    );
    const scope = opts.scope ?? "all";
    const requiredTags = validateTags(opts.tags);
    const where = [`memories_fts MATCH ?`];
    const params = [ftsQuery];
    if (scope === "project") {
      const dir = validateOptionalString(opts.workingDir, "workingDir");
      if (dir === null) return [];
      where.push(`m.working_dir = ?`);
      params.push(dir);
    }
    const sql = `
      SELECT m.id, m.content, m.created_at, m.updated_at,
             m.source, m.session_id, m.working_dir, m.tags,
             m.recall_count, m.last_recalled_at
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
       WHERE ${where.join(" AND ")}
       ORDER BY bm25(memories_fts) ASC
       LIMIT ?`;
    params.push(k * (requiredTags.length > 0 ? 4 : 1));
    const rows = this.db.prepare(sql).all(...params);
    const mapped = rows.map(rowToEntry);
    const filtered = requiredTags.length === 0 ? mapped : mapped.filter((e) => requiredTags.every((t) => e.tags.includes(t)));
    const sliced = filtered.slice(0, k);
    if (sliced.length > 0) this.touchOnRecall(sliced);
    return sliced;
  }
  /**
   * Memory-v2 phase 1A: bump `recall_count` + stamp `last_recalled_at`
   * on every row returned by the most recent `recall()` call. Wrapped
   * in a transaction so all touches commit together; the in-memory
   * entries returned to the caller are also refreshed so downstream
   * consumers see the new values without an extra round-trip.
   *
   * Clock-skew safety (cross-phase invariant 7): `last_recalled_at`
   * is set to `now`. If a stored `created_at` is somehow ahead of
   * `now` (DB clock drift, manual migration), the metric
   * `agent.memory.clock_skew_detected` is incremented with
   * `site=memory_store_recall` and the row is still touched — we
   * prefer "row stays alive" to "row mysteriously skipped".
   */
  touchOnRecall(entries) {
    if (entries.length === 0) return;
    const now = this.now();
    const skewed = [];
    for (const e of entries) {
      const delta = now - e.createdAt;
      if (delta < 0) skewed.push(e);
    }
    if (skewed.length > 0 && this.metrics) {
      for (const e of skewed) {
        this.metrics.recordMemoryClockSkew({
          site: "memory_store_recall",
          deltaMs: now - e.createdAt
        });
      }
    }
    const tx = this.db.transaction((rows) => {
      for (const row of rows) {
        this.recallTouchStmt.run({ id: row.id, now });
      }
    });
    tx(entries);
    for (const e of entries) {
      e.recallCount = e.recallCount + 1;
      e.lastRecalledAt = now;
    }
  }
  get(id) {
    const normalizedId = validateId(id);
    const row = this.getStmt.get(normalizedId);
    return row ? rowToEntry(row) : null;
  }
  remove(id) {
    const normalizedId = validateId(id);
    const result = this.deleteStmt.run(normalizedId);
    return result.changes > 0;
  }
  /**
   * Return entries ordered by `updated_at DESC`. `scope: "project"`
   * filters by `working_dir`. `limit` defaults to 50 and is hard-capped
   * by `MEMORY_LIST_MAX_LIMIT`.
   */
  list(opts = {}) {
    const limit = clampPositiveInt(
      opts.limit ?? 50,
      1,
      MEMORY_LIST_MAX_LIMIT,
      "limit"
    );
    const scope = opts.scope ?? "all";
    const where = [];
    const params = [];
    if (scope === "project") {
      const dir = validateOptionalString(opts.workingDir, "workingDir");
      if (dir === null) return [];
      where.push(`working_dir = ?`);
      params.push(dir);
    }
    if (opts.excludeArchived) {
      where.push(`consolidated_into IS NULL`);
    }
    if (opts.updatedBefore !== void 0) {
      if (!Number.isFinite(opts.updatedBefore)) {
        throw new Error(
          `MemoryStore.list: updatedBefore must be a finite number, got ${opts.updatedBefore}`
        );
      }
      where.push(`updated_at <= ?`);
      params.push(opts.updatedBefore);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT id, content, created_at, updated_at,
             source, session_id, working_dir, tags,
             recall_count, last_recalled_at
        FROM memories
        ${whereClause}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(rowToEntry);
  }
  /**
   * Compact pointer view over recent notes. Returns one row per entry
   * in `updated_at DESC` order, stripped down to the minimum fields
   * needed for the prompt's `### memory-index` section. Kept cheap
   * enough to call on every turn — no FTS round-trip, just a sorted
   * scan over `memories`.
   *
   * The preview is derived from `renderNotePreview` so tests share the
   * same trimming rules with the prompt renderer.
   */
  listIndex(opts = {}) {
    const entries = this.list(opts);
    const previewChars = clampPreviewChars(opts.previewChars);
    return entries.map((e) => ({
      id: e.id,
      preview: renderNotePreview(e.content, previewChars),
      tags: e.tags,
      updatedAt: e.updatedAt,
      workingDir: e.workingDir,
      sessionId: e.sessionId
    }));
  }
  /**
   * Whether a note with exactly this content (trimmed, as `store`
   * writes it) is stored, archived rows included. An importer's re-run
   * check: `list` stops at `MEMORY_LIST_MAX_LIMIT` rows, so it cannot
   * answer this for a large store.
   */
  hasContent(content) {
    return this.hasContentStmt.get(content.trim()) !== void 0;
  }
  /** Total number of stored entries. Useful for tests and diagnostics. */
  count() {
    const row = this.countStmt.get();
    return row.count;
  }
  /**
   * Memory-v2 phase 3. Read the lease column directly without
   * loading the full row. Used by tests and the consolidator path.
   */
  getConsolidatingAt(id) {
    const normalizedId = validateId(id);
    const row = this.db.prepare(`SELECT consolidating_at FROM memories WHERE id = ?`).get(normalizedId);
    return row ? row.consolidating_at : null;
  }
  /**
   * Memory-v2 phase 3. Stamp the B↔C lease on a memory row. Used by
   * phase 5's `ConsolidatorJob` to claim a cluster before clustering.
   * Returns `true` when the stamp landed (the row exists and the
   * previous lease was either NULL or expired). Returns `false` when
   * the row is missing OR another fresh lease is in flight.
   *
   * The check + write is one SQL statement so two consolidator workers
   * cannot both acquire the same row. The reflection-side
   * `neighbor-evolver` does not call this — it only **reads** the
   * lease via `evolveTags` to skip rows under consolidation.
   */
  acquireConsolidationLease(id, leaseMs, now = this.now()) {
    const normalizedId = validateId(id);
    const threshold = now - Math.max(0, leaseMs);
    const r = this.db.prepare(
      `UPDATE memories
            SET consolidating_at = ?
          WHERE id = ?
            AND (consolidating_at IS NULL OR consolidating_at <= ?)`
    ).run(now, normalizedId, threshold);
    return r.changes > 0;
  }
  /**
   * Memory-v2 phase 5. Stamp `consolidated_into` on the given memory
   * rows so they drop out of `### memory-index` while staying
   * recallable by id (cross-phase invariant 9: archived episodes are
   * never deleted). Runs all updates in a single transaction.
   *
   * Returns the number of rows that actually got stamped. Callers
   * may pass ids that are already archived (e.g. by a concurrent
   * tick) — those count as zero changes. Missing ids likewise count
   * as zero.
   */
  archiveInto(parentIds, lessonId, now = this.now()) {
    const normalisedLessonId = validateId(lessonId);
    const normalisedParents = parentIds.map((id) => validateId(id));
    if (normalisedParents.length === 0) return 0;
    const stmt = this.db.prepare(
      `UPDATE memories
          SET consolidated_into = ?,
              updated_at = ?
        WHERE id = ?
          AND consolidated_into IS NULL`
    );
    const txn = this.db.transaction(() => {
      let touched = 0;
      for (const id of normalisedParents) {
        const r = stmt.run(normalisedLessonId, now, id);
        touched += r.changes;
      }
      return touched;
    });
    return txn();
  }
  /**
   * Memory-v2 phase 5. Read the archive back-pointer for a memory
   * row. Returns `null` when the row is missing or still active.
   * Used by the consolidator (idempotency check) and the
   * `### memory-index` exclusion pass.
   */
  getConsolidatedInto(id) {
    const normalisedId = validateId(id);
    const row = this.db.prepare(`SELECT consolidated_into FROM memories WHERE id = ?`).get(normalisedId);
    return row ? row.consolidated_into : null;
  }
  /**
   * Memory-v2 phase 3. Release the B↔C lease (used after the
   * consolidator finishes its sweep, or in tests).
   */
  releaseConsolidationLease(id) {
    const normalizedId = validateId(id);
    const r = this.db.prepare(`UPDATE memories SET consolidating_at = NULL WHERE id = ?`).run(normalizedId);
    return r.changes > 0;
  }
  /**
   * Memory-v2 phase 3. Metadata-only refinement of a memory's tag
   * set. **Content is never touched** — neither the SQL nor the
   * caller interface accepts a content delta, which keeps the
   * append-only contract on `MemoryEntry.content` defended at the
   * store level (cross-phase invariant 5 in MEMORY_FABRIC_V2.md
   * §13.7.7).
   *
   * Semantics:
   *  - `addTags` is merge-only. Duplicates collapse; existing tags are
   *    preserved verbatim. Tag order is `[...existing, ...new-only]`.
   *  - The lease is honoured: when `consolidating_at` is set and the
   *    elapsed window since then is `<= leaseMs`, the call returns
   *    `{ outcome: "skipped_lease_held" }` without mutating the row.
   *    This is the B↔C race guard.
   *  - The lease is **not** acquired by this call — only checked.
   *  - When the resulting tag set is identical to the existing one
   *    (e.g. the LLM proposed tags already present), the call returns
   *    `{ outcome: "skipped_no_change" }` and does not bump
   *    `updated_at` — this preserves the FIFO ordering for
   *    legacy-eviction callers that have not flipped to
   *    `utilityWeighted`.
   *  - Missing target returns `{ outcome: "missing" }`.
   *  - Validation errors (empty `addTags`, invalid tag tokens) throw
   *    `MemoryValidationError` — same surface as `store()`.
   *
   * The `now` parameter is exposed for tests; production callers pass
   * the runner's injected clock.
   */
  evolveTags(id, addTags, opts = { leaseMs: 0 }) {
    const normalizedId = validateId(id);
    const cleanTags = normalizeTagsInput(addTags);
    if (cleanTags.length === 0) {
      throw new MemoryValidationError(
        "tags",
        "evolveTags requires at least one valid tag"
      );
    }
    const now = opts.now ?? this.now();
    const row = this.db.prepare(`SELECT tags, consolidating_at FROM memories WHERE id = ?`).get(normalizedId);
    if (!row) return { outcome: "missing" };
    if (row.consolidating_at !== null) {
      const elapsed = now - row.consolidating_at;
      if (elapsed >= 0 && elapsed <= Math.max(0, opts.leaseMs)) {
        return { outcome: "skipped_lease_held" };
      }
    }
    const existing = parseTags(row.tags);
    const merged = applyEvolveTags(existing, cleanTags);
    if (merged.addedTags.length === 0) {
      return {
        outcome: "skipped_no_change",
        tags: existing
      };
    }
    const nextTagsJson = JSON.stringify(merged.tags);
    this.db.prepare(
      `UPDATE memories
            SET tags = ?,
                updated_at = ?
          WHERE id = ?`
    ).run(nextTagsJson, now, normalizedId);
    return {
      outcome: "applied",
      tags: merged.tags,
      added: merged.addedTags
    };
  }
  /**
   * Memory-v2 phase 3. Validation surface for the
   * `MemoryValidationError.field` discriminant. Exposed mainly to
   * keep the `addTags` field name visible in stack traces from the
   * `evolveTags` path — the error itself is still constructed with
   * the canonical `tags` literal so existing handlers do not break.
   */
  close() {
    this.db.close();
  }
  /**
   * Memory-v2 phase 1B. Returns the live `better-sqlite3` handle so
   * bootstrap can construct an `EmbeddingStore` against the **same**
   * connection (FK cascade depends on it). Intentionally not narrowed
   * to a subset interface — callers should pass the result straight
   * through to `new EmbeddingStore({ db })`.
   *
   * Do not stash a reference outside the runtime: the handle's
   * lifetime is owned by `MemoryStore` and dies with `close()`.
   */
  getDatabaseHandleForEmbeddings() {
    return this.db;
  }
  /**
   * Memory-v2 phase 1B. Late binding for the embedding plumbing.
   * Bootstrap opens the `MemoryStore` first (which owns the SQLite
   * handle and runs migrations), then — once the embedding daemon's
   * health is confirmed — constructs `EmbeddingStore` + `Writer`
   * against the **same** handle and calls this. This avoids a chicken-
   * and-egg dependency where the store would need to be re-created
   * just to add the embedding side.
   *
   * Idempotent: re-attaching after a daemon hot-swap (e.g. operator
   * runs `models stop && models start` with a different embedding
   * model) simply replaces the writer/store.
   */
  attachEmbeddings(args) {
    this.embeddingMinCosine = args.minCosine;
    this.embeddingWriter = args.writer;
    this.embeddingStore = args.store;
    if (args.fts5Weight !== void 0) this.embeddingFts5Weight = args.fts5Weight;
    if (args.vectorWeight !== void 0) this.embeddingVectorWeight = args.vectorWeight;
    if (args.bruteForceCeiling !== void 0) this.embeddingBruteForceCeiling = args.bruteForceCeiling;
  }
  detachEmbeddings() {
    this.embeddingWriter = void 0;
    this.embeddingStore = void 0;
  }
  /**
   * Memory-v2 phase 1B. Fire-and-forget embedding write. Idempotent:
   * the underlying `UPSERT` handles re-embeds when the model is
   * upgraded. Always non-throwing — see `EmbeddingWriter` doc.
   *
   * Public so the bootstrap-time backfill path (re-embed legacy v3
   * rows) can iterate the corpus without going through `store()`.
   */
  async writeEmbeddingFor(memoryId, content) {
    if (!this.embeddingWriter) return false;
    return this.embeddingWriter.writeFor(memoryId, content);
  }
  /**
   * Memory-v2 phase 1B. Hybrid recall: BM25 + cosine blend. When
   * embeddings are not wired (no client / no store / disabled), this
   * is observably identical to `recall(query, opts)` — same hits,
   * same order, same `recall_count` bump.
   *
   * Async because the embedding client makes an HTTP round-trip.
   * Callers that cannot await (legacy synchronous paths) should keep
   * calling `recall()` directly — they will simply miss the cosine
   * re-ranking.
   */
  async recallHybridAsync(query, opts = {}) {
    const normalizedQuery = validateQuery(query);
    const ftsQuery = buildFtsQuery(normalizedQuery);
    if (ftsQuery.length === 0) return [];
    const k = clampPositiveInt(
      opts.k ?? MEMORY_RECALL_DEFAULT_K,
      1,
      MEMORY_RECALL_MAX_K,
      "k"
    );
    const scope = opts.scope ?? "all";
    const requiredTags = validateTags(opts.tags);
    let workingDir;
    if (scope === "project") {
      const dir = validateOptionalString(opts.workingDir, "workingDir");
      if (dir === null) return [];
      workingDir = dir;
    }
    const bm25Hits = this.recallRaw(
      ftsQuery,
      workingDir ?? null,
      requiredTags,
      k * 4
    );
    if (!this.embeddingWriter || !this.embeddingStore) {
      const sliced = bm25Hits.slice(0, k);
      if (sliced.length > 0) this.touchOnRecall(sliced);
      return sliced;
    }
    const deps = {
      embeddingClient: this.embeddingWriter.client,
      embeddingStore: this.embeddingStore,
      bruteForceCeiling: this.embeddingBruteForceCeiling,
      fts5Weight: this.embeddingFts5Weight,
      vectorWeight: this.embeddingVectorWeight,
      ...this.metrics ? { metrics: this.metrics } : {},
      // Notes found by meaning alone come back as full entries, the same
      // shape (and the same recall_count bump below) as keyword hits.
      hydrate: (ids) => this.getMany(ids),
      ...this.embeddingMinCosine !== void 0 ? { minCosine: this.embeddingMinCosine } : {}
    };
    const blended = await recallHybrid(deps, {
      k,
      bm25Hits,
      query: normalizedQuery,
      ...workingDir !== void 0 ? { workingDir } : {},
      requiredTags
    });
    if (blended.length > 0) this.touchOnRecall(blended);
    return blended;
  }
  /** Entries by id, in no particular order; ids that do not exist are left out. */
  getMany(ids) {
    if (ids.length === 0) return [];
    const rows = this.db.prepare(
      `SELECT id, content, created_at, updated_at, source, session_id, working_dir, tags,
                recall_count, last_recalled_at
           FROM memories WHERE id IN (${ids.map(() => "?").join(", ")})`
    ).all(...ids);
    return rows.map(rowToEntry);
  }
  /**
   * Internal BM25-only fetch used by both `recall` and
   * `recallHybridAsync`. Returns the raw `bm25Score` alongside the
   * `MemoryEntry` so the hybrid layer can blend without a second
   * round-trip. No `recall_count` touch here — callers do that after
   * the final slice is selected.
   */
  recallRaw(ftsQuery, workingDir, requiredTags, limit) {
    const where = [`memories_fts MATCH ?`];
    const params = [ftsQuery];
    if (workingDir !== null) {
      where.push(`m.working_dir = ?`);
      params.push(workingDir);
    }
    const sql = `
      SELECT m.id, m.content, m.created_at, m.updated_at,
             m.source, m.session_id, m.working_dir, m.tags,
             m.recall_count, m.last_recalled_at,
             bm25(memories_fts) AS bm25
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
       WHERE ${where.join(" AND ")}
       ORDER BY bm25 ASC
       LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params);
    const filtered = requiredTags.length === 0 ? rows : rows.filter(
      (r) => requiredTags.every((t) => parseTags(r.tags).includes(t))
    );
    return filtered.map((r) => ({
      ...rowToEntry(r),
      bm25Score: r.bm25
    }));
  }
  evictOverflow() {
    const current = this.count();
    if (current <= this.maxEntries) return;
    const excess = current - this.maxEntries;
    const stmt = this.evictionUtilityWeighted ? this.evictUtilityStmt : this.evictFifoStmt;
    const result = stmt.run(excess);
    this.metrics?.recordMemoryEviction({
      reason: "overflow",
      evicted: result.changes,
      utilityWeighted: this.evictionUtilityWeighted
    });
  }
}
class MemoryValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = "MemoryValidationError";
  }
}
function validateContent(raw) {
  if (typeof raw !== "string") {
    throw new MemoryValidationError(
      "content",
      "memory content must be a string"
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new MemoryValidationError(
      "content",
      "memory content must be non-empty"
    );
  }
  if (trimmed.length > MEMORY_CONTENT_MAX_LENGTH) {
    throw new MemoryValidationError(
      "content",
      `memory content must be at most ${MEMORY_CONTENT_MAX_LENGTH} chars`
    );
  }
  return trimmed;
}
function validateTags(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new MemoryValidationError("tags", "tags must be a string array");
  }
  if (raw.length > MEMORY_MAX_TAGS) {
    throw new MemoryValidationError(
      "tags",
      `tags must contain at most ${MEMORY_MAX_TAGS} entries`
    );
  }
  const normalized = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (typeof entry !== "string") {
      throw new MemoryValidationError("tags", `tags[${i}] must be a string`);
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new MemoryValidationError("tags", `tags[${i}] must be non-empty`);
    }
    if (trimmed.length > MEMORY_TAG_MAX_LENGTH) {
      throw new MemoryValidationError(
        "tags",
        `tags[${i}] must be at most ${MEMORY_TAG_MAX_LENGTH} chars`
      );
    }
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  return normalized;
}
function normalizeTagsInput(raw) {
  return validateTags(raw);
}
function applyEvolveTags(existing, addTags) {
  const merged = [...existing];
  const addedTags = [];
  for (const tag of addTags) {
    if (merged.length >= MEMORY_MAX_TAGS) break;
    if (merged.includes(tag)) continue;
    merged.push(tag);
    addedTags.push(tag);
  }
  return { tags: merged, addedTags };
}
function validateQuery(raw) {
  if (typeof raw !== "string") {
    throw new MemoryValidationError("query", "query must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length > MEMORY_QUERY_MAX_LENGTH) {
    throw new MemoryValidationError(
      "query",
      `query must be at most ${MEMORY_QUERY_MAX_LENGTH} chars`
    );
  }
  return trimmed;
}
function validateSource(raw) {
  if (raw === "agent" || raw === "user") return raw;
  throw new MemoryValidationError(
    "source",
    `source must be 'agent' or 'user', got ${JSON.stringify(raw)}`
  );
}
function validateOptionalString(raw, field) {
  if (raw === void 0 || raw === null) return null;
  if (typeof raw !== "string") {
    throw new MemoryValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
function validateId(raw) {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new MemoryValidationError(
      "id",
      `id must be a positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}
function clampPositiveInt(raw, min, max, field) {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new MemoryValidationError(
      field,
      `${field} must be an integer, got ${JSON.stringify(raw)}`
    );
  }
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}
function rowToEntry(row) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source === "user" ? "user" : "agent",
    sessionId: row.session_id,
    workingDir: row.working_dir,
    tags: parseTags(row.tags),
    // Memory-v2 phase 1A: columns default to 0 / NULL when read from
    // a v3 row migrated forward by `V4_MIGRATION`. Stored as INTEGER
    // in SQLite — coerce explicitly so JS-side comparisons stay safe.
    recallCount: typeof row.recall_count === "number" ? row.recall_count : 0,
    lastRecalledAt: typeof row.last_recalled_at === "number" ? row.last_recalled_at : null
  };
}
function tokeniseForSimilarity(text) {
  const set = /* @__PURE__ */ new Set();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const t = raw.trim();
    if (t.length <= 2) continue;
    set.add(t);
  }
  return set;
}
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) {
    if (large.has(t)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
function isTagSuperset(existing, incoming) {
  if (incoming.length === 0) return true;
  const set = new Set(existing);
  for (const t of incoming) {
    if (!set.has(t)) return false;
  }
  return true;
}
function mergeTagSets(a, b) {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of a) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of b) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
function renderNotePreview(content, maxChars) {
  const firstLine = content.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (firstLine.length <= maxChars) return firstLine;
  if (maxChars <= 1) return firstLine.slice(0, maxChars);
  return `${firstLine.slice(0, maxChars - 1)}\u2026`;
}
function clampPreviewChars(raw) {
  if (raw === void 0 || raw === null)
    return MEMORY_INDEX_PREVIEW_CHARS_DEFAULT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return MEMORY_INDEX_PREVIEW_CHARS_DEFAULT;
  }
  return Math.min(raw, MEMORY_INDEX_PREVIEW_CHARS_MAX);
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
function buildFtsQuery(query) {
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
export {
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_INDEX_PREVIEW_CHARS_DEFAULT,
  MEMORY_INDEX_PREVIEW_CHARS_MAX,
  MEMORY_LIST_MAX_LIMIT,
  MEMORY_MAX_TAGS,
  MEMORY_QUERY_MAX_LENGTH,
  MEMORY_RECALL_DEFAULT_K,
  MEMORY_RECALL_MAX_K,
  MEMORY_TAG_MAX_LENGTH,
  MemoryStore,
  MemoryValidationError,
  renderNotePreview
};
