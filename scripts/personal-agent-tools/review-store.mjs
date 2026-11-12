import { createHash } from 'node:crypto'

const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase()
const secret = text => /(?:sk-[a-z0-9]{16,}|-----BEGIN .*PRIVATE KEY|(?:password|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+)/i.test(text)
export class ReviewStore {
  constructor(notes) {
    this.db = notes.database().getDatabaseHandleForEmbeddings()
    this.db.exec(`CREATE TABLE IF NOT EXISTS atomic_review_runs (
      id INTEGER PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      changes TEXT NOT NULL, created_at INTEGER NOT NULL, undone_at INTEGER);
      CREATE TABLE IF NOT EXISTS atomic_review_lessons (
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, stable_key TEXT NOT NULL, activation TEXT NOT NULL,
      principle TEXT NOT NULL, steps TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
      evidence TEXT NOT NULL, previous_id INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL);`)
  }
  context(query = '') {
    const words = normalize(query).split(/\s+/).filter(word => word.length > 1)
    return this.db.prepare("SELECT * FROM atomic_review_lessons WHERE status='active' ORDER BY id DESC LIMIT 100").all()
      .filter(row => row.scope === 'standing' || words.some(word => normalize(row.activation + ' ' + row.principle).includes(word)))
      .slice(0, 3).map(row => ({ id: `review:${row.id}`, content: `Learned guidance for ${row.activation}: ${row.principle}${JSON.parse(row.steps).length ? '\nSteps: ' + JSON.parse(row.steps).map(s => s.text).join('; ') : ''}`, sessionId: `background-review:${row.run_id}` }))
  }
  existing() {
    return this.db.prepare("SELECT stable_key AS key, activation, principle, kind FROM atomic_review_lessons WHERE status='active' ORDER BY id DESC LIMIT 12").all()
  }
  apply(input, proposals) {
    if (!Array.isArray(proposals) || proposals.length > 3) throw new Error('Invalid background review proposals')
    const evidence = new Map((input.evidence ?? []).map(row => [row.id, row]))
    const keys = new Set()
    const valid = proposals.map(p => {
      if (!p || !['correction','procedure'].includes(p.kind) || !['standing','contextual'].includes(p.scope) || typeof p.activation !== 'string' || !p.activation.trim() || p.activation.length > 240 || typeof p.principle !== 'string' || !p.principle.trim() || p.principle.length > 800 || secret(p.activation + p.principle)) throw new Error('Invalid learned guidance')
      const refs = p.evidence
      if (!Array.isArray(refs) || !refs.length || refs.length > 8 || refs.some(ref => typeof ref.quote !== 'string' || ref.quote.length < 4 || ref.quote.length > 500 || !evidence.get(ref.id)?.text.includes(ref.quote) || secret(ref.quote))) throw new Error('Review evidence does not match observed dialogue')
      if (p.kind === 'correction' && !refs.some(ref => evidence.get(ref.id)?.role === 'user' && evidence.get(ref.id)?.correction)) throw new Error('A correction needs an observed user correction')
      if (p.kind !== 'correction' && p.scope === 'standing') throw new Error('Procedures must be contextual')
      if (p.scope === 'standing' && !refs.some(ref => evidence.get(ref.id)?.standing)) throw new Error('Standing guidance needs an explicit durable user preference')
      const steps = p.steps ?? []
      if (!Array.isArray(steps) || (p.kind === 'procedure' && (steps.length < 2 || steps.length > 8)) || (p.kind === 'correction' && steps.length)) throw new Error('Invalid learned procedure')
      for (const step of steps) {
        const source = evidence.get(step.evidenceId)
        if (!source?.verified || source.role !== 'tool' || typeof step.text !== 'string' || !step.text.trim() || step.text.length > 600 || typeof step.quote !== 'string' || step.quote.length < 4 || !source.text.includes(step.quote) || secret(step.text + step.quote)) throw new Error('Every procedure step needs successful tool evidence')
      }
      const key = typeof p.key === 'string' && this.existing().some(row => row.key === p.key && row.kind === p.kind && normalize(row.activation) === normalize(p.activation)) ? p.key : createHash('sha256').update(p.kind + ':' + normalize(p.activation)).digest('hex')
      if (keys.has(key)) throw new Error('Duplicate guidance in one review')
      keys.add(key)
      return { ...p, steps, key }
    })
    return this.db.transaction(() => {
      const sourceKey = `${input.sessionId}:${input.messageId}`
      if (this.db.prepare('SELECT id FROM atomic_review_runs WHERE source_key=?').get(sourceKey)) return { duplicate: true, changes: [] }
      const at = Date.now(), changes = []
      const run = Number(this.db.prepare('INSERT INTO atomic_review_runs(source_key,session_id,message_id,changes,created_at) VALUES(?,?,?,?,?)').run(sourceKey,input.sessionId,input.messageId,'[]',at).lastInsertRowid)
      for (const p of valid) {
        const old = this.db.prepare("SELECT * FROM atomic_review_lessons WHERE stable_key=? AND status='active'").get(p.key)
        if (old && normalize(old.principle) === normalize(p.principle) && JSON.stringify(JSON.parse(old.steps).map(s => normalize(s.text))) === JSON.stringify(p.steps.map(s => normalize(s.text)))) continue
        if (old) this.db.prepare("UPDATE atomic_review_lessons SET status='superseded' WHERE id=?").run(old.id)
        const id = Number(this.db.prepare('INSERT INTO atomic_review_lessons(run_id,stable_key,activation,principle,steps,kind,scope,evidence,previous_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(run,p.key,p.activation,p.principle,JSON.stringify(p.steps),p.kind,p.scope,JSON.stringify(p.evidence),old?.id ?? null,'active',at).lastInsertRowid)
        changes.push({ id, previousId: old?.id ?? null, activation:p.activation, principle:p.principle, kind:p.kind, steps:p.steps, evidence:p.evidence })
      }
      this.db.prepare('UPDATE atomic_review_runs SET changes=? WHERE id=?').run(JSON.stringify(changes),run)
      return { id:run, changes }
    })()
  }
  history() { return this.db.prepare('SELECT id,session_id AS sessionId,message_id AS messageId,changes,created_at AS createdAt,undone_at AS undoneAt FROM atomic_review_runs WHERE changes != ? ORDER BY id DESC LIMIT 20').all('[]').map(row => ({ ...row, changes:JSON.parse(row.changes) })) }
  undo(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid review identifier')
    return this.db.transaction(() => {
      const run = this.db.prepare('SELECT * FROM atomic_review_runs WHERE id=?').get(id)
      if (!run || run.undone_at) throw new Error('Review is missing or already undone')
      const changes = JSON.parse(run.changes)
      for (const change of changes) {
        const row = this.db.prepare('SELECT status FROM atomic_review_lessons WHERE id=?').get(change.id)
        if (row?.status !== 'active') throw new Error('Undo the newer related review first')
      }
      for (const change of changes) {
        this.db.prepare("UPDATE atomic_review_lessons SET status='undone' WHERE id=?").run(change.id)
        if (change.previousId) this.db.prepare("UPDATE atomic_review_lessons SET status='active' WHERE id=? AND status='superseded'").run(change.previousId)
      }
      this.db.prepare('UPDATE atomic_review_runs SET undone_at=? WHERE id=?').run(Date.now(),id)
      return { undone:true, id }
    })()
  }
}
