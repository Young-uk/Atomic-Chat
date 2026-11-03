const kinds = ['RELATES_TO', 'CAUSED_BY', 'REFERENCES', 'CONTRADICTS', 'DUPLICATES', 'SUPERSEDES']

// Fact IDs and note IDs overlap. Keep fact edges in their own namespace;
// never reinterpret a numeric ID or migrate existing note edges implicitly.
export class ProfileLinks {
  constructor(db, profile) {
    this.db = db
    this.profile = profile
    db.exec(`CREATE TABLE IF NOT EXISTS atomic_profile_links (
      from_id INTEGER NOT NULL REFERENCES profile_facts(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES profile_facts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, PRIMARY KEY(from_id, to_id, kind))`)
  }
  call(args) {
    const edges = () => this.db.prepare('SELECT from_id AS fromId, to_id AS toId, kind FROM atomic_profile_links ORDER BY from_id, to_id, kind LIMIT 100').all()
    if (args.action === 'list') return edges()
    for (const id of [args.id, ...(args.action === 'get' ? [] : [args.targetId])]) {
      if (!Number.isSafeInteger(id) || !this.profile.getById(id)) throw new Error('An existing profile fact id is required for profile links')
    }
    if (args.action === 'get') {
      const visited = new Set([args.id])
      let frontier = [args.id]
      const adjacent = this.db.prepare('SELECT to_id AS id FROM atomic_profile_links WHERE from_id = ? UNION SELECT from_id AS id FROM atomic_profile_links WHERE to_id = ? ORDER BY id')
      for (let depth = 0; depth < 2; depth++) {
        const next = []
        for (const id of frontier) for (const row of adjacent.all(id, id)) {
          if (!visited.has(row.id) && visited.size < 51) { visited.add(row.id); next.push(row.id) }
        }
        frontier = next
      }
      return [...visited].filter(id => id !== args.id)
    }
    if (!kinds.includes(args.kind)) throw new Error('A supported link kind is required')
    if (args.id === args.targetId) throw new Error('A link must connect two different facts')
    if (args.action === 'save') {
      this.db.prepare('INSERT OR IGNORE INTO atomic_profile_links(from_id, to_id, kind) VALUES (?, ?, ?)').run(args.id, args.targetId, args.kind)
      return { entityType: 'profile', fromId: args.id, toId: args.targetId, kind: args.kind }
    }
    if (args.action === 'forget') return { removed: this.db.prepare('DELETE FROM atomic_profile_links WHERE from_id = ? AND to_id = ? AND kind = ?').run(args.id, args.targetId, args.kind).changes > 0 }
    throw new Error('Unsupported profile link action')
  }
}
