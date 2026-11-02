function assertProfileMaxEntries(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(
      `ProfileStore: maxEntries must be a positive integer, got ${maxEntries}`
    );
  }
}
class ProfileEvictor {
  constructor(db, maxEntries) {
    this.maxEntries = maxEntries;
    assertProfileMaxEntries(maxEntries);
    this.countStmt = db.prepare(
      `SELECT COUNT(*) AS count FROM profile_facts
        WHERE superseded_by IS NULL AND pinned = 0`
    );
    this.pickStmt = db.prepare(
      `SELECT id, key FROM profile_facts
        WHERE superseded_by IS NULL AND pinned = 0 AND id != @keep_id
        ORDER BY vote_score ASC, updated_at ASC, id ASC
        LIMIT @limit`
    );
    this.deleteStmt = db.prepare(
      `DELETE FROM profile_facts
        WHERE id = ? AND superseded_by IS NULL AND pinned = 0`
    );
  }
  countStmt;
  pickStmt;
  deleteStmt;
  /**
   * Trim active unpinned facts down to the cap, sparing `keepId`. Must
   * run inside the caller's write transaction. `null` when under the cap.
   */
  evictOverflow(keepId) {
    const { count } = this.countStmt.get();
    if (count <= this.maxEntries) return null;
    const picked = this.pickStmt.all({
      keep_id: keepId,
      limit: count - this.maxEntries
    });
    const evicted = [];
    for (const row of picked) {
      const result = this.deleteStmt.run(row.id);
      if (result.changes > 0) evicted.push({ id: row.id, key: row.key });
    }
    if (evicted.length === 0) return null;
    return {
      evicted,
      maxEntries: this.maxEntries,
      activeUnpinned: count - evicted.length
    };
  }
}
export {
  ProfileEvictor,
  assertProfileMaxEntries
};
