const LINK_KINDS = [
  "RELATES_TO",
  "CAUSED_BY",
  "REFERENCES",
  "CONTRADICTS",
  "DUPLICATES",
  "SUPERSEDES"
];
function isLinkKind(raw) {
  return LINK_KINDS.includes(raw);
}
class LinkValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = "LinkValidationError";
  }
}
const LINK_LIST_ALL_DEFAULT_LIMIT = 500;
const LINK_LIST_ALL_MAX_LIMIT = 1e3;
class LinkStore {
  db;
  now;
  upsertStmt;
  getStmt;
  listOutgoingStmt;
  listIncomingStmt;
  listOutgoingAllStmt;
  listIncomingAllStmt;
  countStmt;
  listAllStmt;
  deleteStmt;
  deleteAllForMemoryStmt;
  constructor(opts) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
    this.upsertStmt = this.db.prepare(
      `INSERT INTO memory_links (from_id, to_id, kind, weight, created_at)
       VALUES (@from_id, @to_id, @kind, @weight, @created_at)
       ON CONFLICT(from_id, to_id, kind) DO UPDATE SET
         weight = excluded.weight,
         created_at = excluded.created_at`
    );
    this.getStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        WHERE from_id = ? AND to_id = ? AND kind = ?`
    );
    this.listOutgoingStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        WHERE from_id = ? AND kind IN (SELECT value FROM json_each(?))
        ORDER BY weight DESC, created_at DESC`
    );
    this.listIncomingStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        WHERE to_id = ? AND kind IN (SELECT value FROM json_each(?))
        ORDER BY weight DESC, created_at DESC`
    );
    this.listOutgoingAllStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        WHERE from_id = ?
        ORDER BY weight DESC, created_at DESC`
    );
    this.listIncomingAllStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        WHERE to_id = ?
        ORDER BY weight DESC, created_at DESC`
    );
    this.countStmt = this.db.prepare(
      `SELECT COUNT(*) AS count FROM memory_links`
    );
    this.listAllStmt = this.db.prepare(
      `SELECT from_id, to_id, kind, weight, created_at
         FROM memory_links
        ORDER BY created_at DESC
        LIMIT ?`
    );
    this.deleteStmt = this.db.prepare(
      `DELETE FROM memory_links WHERE from_id = ? AND to_id = ? AND kind = ?`
    );
    this.deleteAllForMemoryStmt = this.db.prepare(
      `DELETE FROM memory_links WHERE from_id = ? OR to_id = ?`
    );
  }
  add(input, now = this.now()) {
    if (!Number.isInteger(input.fromId) || input.fromId <= 0) {
      throw new LinkValidationError(
        "fromId",
        `expected positive integer, got ${input.fromId}`
      );
    }
    if (!Number.isInteger(input.toId) || input.toId <= 0) {
      throw new LinkValidationError(
        "toId",
        `expected positive integer, got ${input.toId}`
      );
    }
    if (input.fromId === input.toId) {
      throw new LinkValidationError(
        "toId",
        "self-loop rejected (from_id == to_id)"
      );
    }
    if (!isLinkKind(input.kind)) {
      throw new LinkValidationError(
        "kind",
        `unknown link kind ${JSON.stringify(input.kind)}; allowed: ${LINK_KINDS.join(", ")}`
      );
    }
    const weight = clampUnit(input.weight ?? 1);
    this.upsertStmt.run({
      from_id: input.fromId,
      to_id: input.toId,
      kind: input.kind,
      weight,
      created_at: now
    });
    return {
      fromId: input.fromId,
      toId: input.toId,
      kind: input.kind,
      weight,
      createdAt: now
    };
  }
  get(fromId, toId, kind) {
    const row = this.getStmt.get(fromId, toId, kind);
    if (!row) return null;
    return {
      fromId: row.from_id,
      toId: row.to_id,
      kind: row.kind,
      weight: row.weight,
      createdAt: row.created_at
    };
  }
  listOutgoing(fromId, kinds) {
    const rows = kinds && kinds.length > 0 ? this.listOutgoingStmt.all(fromId, JSON.stringify(kinds)) : this.listOutgoingAllStmt.all(fromId);
    return rows.map(rowToLink);
  }
  listIncoming(toId, kinds) {
    const rows = kinds && kinds.length > 0 ? this.listIncomingStmt.all(toId, JSON.stringify(kinds)) : this.listIncomingAllStmt.all(toId);
    return rows.map(rowToLink);
  }
  remove(fromId, toId, kind) {
    const r = this.deleteStmt.run(fromId, toId, kind);
    return r.changes > 0;
  }
  /**
   * Wipe every edge that touches `memoryId`. Normally unnecessary —
   * the FK cascade fires on `memories.remove(id)` — but useful when
   * the operator wants to reset just the graph without dropping the
   * memory itself.
   */
  removeAllForMemory(memoryId) {
    const r = this.deleteAllForMemoryStmt.run(memoryId, memoryId);
    return r.changes;
  }
  count() {
    const row = this.countStmt.get();
    return row.count;
  }
  /**
   * Newest edges first — operator inspection for TUI/CLI graph tables.
   * Does not dedupe; one row per `(from_id, to_id, kind)` triple.
   */
  listAll(opts = {}) {
    const raw = opts.limit ?? LINK_LIST_ALL_DEFAULT_LIMIT;
    const limit = Math.min(
      LINK_LIST_ALL_MAX_LIMIT,
      Math.max(1, Math.floor(raw))
    );
    const rows = this.listAllStmt.all(limit);
    return rows.map(rowToLink);
  }
  /**
   * Breadth-first traversal from `seedIds`. Walks **both directions**
   * at each hop (outgoing + incoming) so the recall layer can surface
   * related memories without forcing the LLM to author symmetric
   * edges.
   *
   * Returns ids in BFS order, with seeds **excluded** from the
   * result. Deduplicated. Bounded by `depth` (default 1, max 3) and
   * `maxExpanded` (default 50). When the cap is hit, the traversal
   * stops mid-hop — last-in-rank entries are dropped, so weight-
   * ordered hops produce stable top-N expansions.
   *
   * Empty seed ⇒ empty result.
   */
  expand(seedIds, opts = {}) {
    if (seedIds.length === 0) return [];
    const depth = Math.max(1, Math.min(3, Math.floor(opts.depth ?? 1)));
    const maxExpanded = Math.max(1, opts.maxExpanded ?? 50);
    const kinds = opts.kinds;
    const seen = /* @__PURE__ */ new Set();
    for (const id of seedIds) seen.add(id);
    const result = [];
    let frontier = [...seedIds];
    for (let d = 0; d < depth; d += 1) {
      const next = [];
      for (const node of frontier) {
        const outgoing = this.listOutgoing(node, kinds);
        const incoming = this.listIncoming(node, kinds);
        for (const e of outgoing) {
          if (seen.has(e.toId)) continue;
          if (opts.excludeSelfLoops && e.toId === node) continue;
          seen.add(e.toId);
          result.push(e.toId);
          next.push(e.toId);
          if (result.length >= maxExpanded) return result;
        }
        for (const e of incoming) {
          if (seen.has(e.fromId)) continue;
          if (opts.excludeSelfLoops && e.fromId === node) continue;
          seen.add(e.fromId);
          result.push(e.fromId);
          next.push(e.fromId);
          if (result.length >= maxExpanded) return result;
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return result;
  }
}
function rowToLink(row) {
  return {
    fromId: row.from_id,
    toId: row.to_id,
    kind: row.kind,
    weight: row.weight,
    createdAt: row.created_at
  };
}
function clampUnit(v) {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
export {
  LINK_KINDS,
  LINK_LIST_ALL_DEFAULT_LIMIT,
  LINK_LIST_ALL_MAX_LIMIT,
  LinkStore,
  LinkValidationError,
  isLinkKind
};
