import { endianness } from "node:os";
class EmbeddingStore {
  db;
  upsertStmt;
  getStmt;
  listByModelStmt;
  listNewestByModelStmt;
  countByModelStmt;
  countPerModelStmt;
  deleteByIdStmt;
  deleteByModelStmt;
  constructor(opts) {
    this.db = opts.db;
    this.upsertStmt = this.db.prepare(
      `INSERT INTO memory_embeddings (memory_id, model, dim, embedding, created_at)
       VALUES (@memory_id, @model, @dim, @embedding, @created_at)
       ON CONFLICT(memory_id, model) DO UPDATE SET
         dim = excluded.dim,
         embedding = excluded.embedding,
         created_at = excluded.created_at`
    );
    this.getStmt = this.db.prepare(
      `SELECT memory_id, model, dim, embedding, created_at
         FROM memory_embeddings WHERE memory_id = ? AND model = ?`
    );
    this.listByModelStmt = this.db.prepare(
      `SELECT e.memory_id AS memory_id, e.model AS model, e.dim AS dim,
              e.embedding AS embedding, e.created_at AS created_at,
              m.working_dir AS working_dir, m.tags AS tags
         FROM memory_embeddings e
         JOIN memories m ON m.id = e.memory_id
        WHERE e.model = ?`
    );
    this.listNewestByModelStmt = this.db.prepare(
      `SELECT e.memory_id AS memory_id, e.model AS model, e.dim AS dim,
              e.embedding AS embedding, e.created_at AS created_at,
              m.working_dir AS working_dir, m.tags AS tags
         FROM memory_embeddings e
         JOIN memories m ON m.id = e.memory_id
        WHERE e.model = ?
        ORDER BY e.memory_id DESC
        LIMIT ?`
    );
    this.countByModelStmt = this.db.prepare(
      `SELECT COUNT(*) AS count FROM memory_embeddings WHERE model = ?`
    );
    this.countPerModelStmt = this.db.prepare(
      `SELECT model, COUNT(*) AS count FROM memory_embeddings
        GROUP BY model ORDER BY model`
    );
    this.deleteByIdStmt = this.db.prepare(
      `DELETE FROM memory_embeddings WHERE memory_id = ?`
    );
    this.deleteByModelStmt = this.db.prepare(
      `DELETE FROM memory_embeddings WHERE model = ?`
    );
  }
  /**
   * Insert or replace the embedding for `(memoryId, model)`. Idempotent:
   * a re-embed for the same row simply overwrites — useful when the
   * embedding model is upgraded in place.
   */
  upsert(row) {
    if (row.vector.length !== row.dim) {
      throw new Error(
        `EmbeddingStore: vector length ${row.vector.length} != dim ${row.dim}`
      );
    }
    this.upsertStmt.run({
      memory_id: row.memoryId,
      model: row.model,
      dim: row.dim,
      embedding: float32ToBuffer(row.vector),
      created_at: row.createdAt
    });
  }
  get(memoryId, model) {
    const row = this.getStmt.get(memoryId, model);
    if (!row) return null;
    return {
      memoryId: row.memory_id,
      model: row.model,
      dim: row.dim,
      vector: bufferToFloat32(row.embedding, row.dim),
      createdAt: row.created_at
    };
  }
  /**
   * Full corpus scan for the given embedding model. Returned rows
   * carry `workingDir` and `tags` so the recall layer can apply the
   * same filters that FTS5 enforces in-query. Use sparingly — this is
   * the brute-force path for hybrid recall and is bounded by
   * `memory.embeddings.bruteForceCeiling` rows.
   */
  listByModel(model) {
    const rows = this.listByModelStmt.all(model);
    return rows.map((r) => ({
      memoryId: r.memory_id,
      model: r.model,
      dim: r.dim,
      vector: bufferToFloat32(r.embedding, r.dim),
      createdAt: r.created_at,
      workingDir: r.working_dir,
      tags: parseTags(r.tags)
    }));
  }
  /** The newest `limit` notes' vectors for `model`, newest first; same shape as `listByModel`. */
  listNewestByModel(model, limit) {
    return this.listNewestByModelStmt.all(model, limit).map(listedRowToEmbedding);
  }
  /**
   * The given notes' vectors for `model`, with the same metadata as
   * `listByModel`. Hybrid recall adds them to the newest vectors above
   * the brute-force ceiling, so every keyword hit keeps its re-rank. Ids
   * without a vector are absent.
   */
  listByModelForMemories(model, memoryIds) {
    if (memoryIds.length === 0) return [];
    const rows = this.db.prepare(
      `SELECT e.memory_id AS memory_id, e.model AS model, e.dim AS dim,
                e.embedding AS embedding, e.created_at AS created_at,
                m.working_dir AS working_dir, m.tags AS tags
           FROM memory_embeddings e
           JOIN memories m ON m.id = e.memory_id
          WHERE e.model = ? AND e.memory_id IN (${memoryIds.map(() => "?").join(", ")})`
    ).all(model, ...memoryIds);
    return rows.map(listedRowToEmbedding);
  }
  countByModel(model) {
    const row = this.countByModelStmt.get(model);
    return row.count;
  }
  /** Vector counts per model, for pruning the models no longer in use. */
  countPerModel() {
    return this.countPerModelStmt.all();
  }
  /** Delete every embedding for a single `memoryId` across all models. */
  deleteAllForMemory(memoryId) {
    const r = this.deleteByIdStmt.run(memoryId);
    return r.changes;
  }
  /** Wipe a model's rows wholesale — used when migrating to a new model. */
  deleteAllForModel(model) {
    const r = this.deleteByModelStmt.run(model);
    return r.changes;
  }
}
function listedRowToEmbedding(r) {
  return {
    memoryId: r.memory_id,
    model: r.model,
    dim: r.dim,
    vector: bufferToFloat32(r.embedding, r.dim),
    createdAt: r.created_at,
    workingDir: r.working_dir,
    tags: parseTags(r.tags)
  };
}
function float32ToBuffer(v) {
  return Buffer.from(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}
function bufferToFloat32(buf, dim) {
  if (buf.length !== dim * 4) {
    throw new Error(
      `EmbeddingStore: corrupt blob \u2014 expected ${dim * 4} bytes, got ${buf.length}`
    );
  }
  if (LITTLE_ENDIAN_HOST) {
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + dim * 4));
  }
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    out[i] = buf.readFloatLE(i * 4);
  }
  return out;
}
const LITTLE_ENDIAN_HOST = endianness() === "LE";
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
export {
  EmbeddingStore
};
