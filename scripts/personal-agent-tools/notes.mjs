import { ProfileLinks } from './profile-links.mjs'
import { semanticMemory } from './semantic-memory.mjs'
import { join } from 'node:path'
import { MemoryStore } from './agent-source/memory/memory-store.mjs'
import { ProfileStore } from './agent-source/memory/profile-store.mjs'
import { LinkStore } from './agent-source/memory/links/link-store.mjs'
import { LessonStore } from './agent-source/memory/lessons/lesson-store.mjs'
import { ProcedureStore } from './agent-source/memory/procedures/procedure-store.mjs'
import { selectProfileFacts } from './agent-source/suite/memory/profile-renderer.mjs'

// Keep the existing explicit-memory JSON untouched. Source-backed notes use
// a separate Chat-owned database, never the standalone Agent's private files.
export class PersonalNotes {
  constructor(directory, workspace) { this.directory = directory; this.workspace = workspace }
  database() {
    this.store ??= new MemoryStore({ dbFile: join(this.directory, 'agent-notes.sqlite'), maxEntries: 2000 })
    return this.store
  }
  // Keep provenance separate from the upstream author classification. Older
  // Chat notes placed the source reference in session_id; decode that legacy
  // representation without rewriting the original row.
  provenanceDatabase() {
    const db = this.database().getDatabaseHandleForEmbeddings()
    db.exec('CREATE TABLE IF NOT EXISTS atomic_note_provenance (note_id INTEGER PRIMARY KEY, source_reference TEXT NOT NULL)')
    return db
  }
  withProvenance(value) {
    if (Array.isArray(value)) return value.map(row => this.withProvenance(row))
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value.entries)) return { ...value, entries: this.withProvenance(value.entries) }
    if (!Number.isSafeInteger(value.id)) return value
    const row = this.provenanceDatabase().prepare('SELECT source_reference FROM atomic_note_provenance WHERE note_id = ?').get(value.id)
    const original = this.database().get(value.id)
    if (!original) return value
    return { ...value, author: original.source,
      sourceReference: row?.source_reference ?? original.sessionId,
      sessionId: row ? original.sessionId : null }
  }
  call(args) {
    const result = this.callRaw(args)
    return result instanceof Promise ? result.then(value => this.withProvenance(value)) : this.withProvenance(result)
  }
  callRaw(args) {
    const store = this.database()
    if (args.action === 'save') {
      const sourceReference = args.sourceReference ?? args.source
      if (typeof sourceReference !== 'string' || !sourceReference.trim() || sourceReference.length > 2000) throw new Error('A verifiable source reference is required')
      if (args.sessionId !== undefined && (typeof args.sessionId !== 'string' || !args.sessionId.trim() || args.sessionId.length > 2000)) throw new Error('A valid sessionId is required')
      const db = this.provenanceDatabase()
      return db.transaction(() => {
        const entry = store.store({ content: args.text, tags: args.tags, source: 'user', sessionId: args.sessionId, workingDir: this.workspace })
        db.prepare('INSERT OR REPLACE INTO atomic_note_provenance (note_id, source_reference) VALUES (?, ?)').run(entry.id, sourceReference)
        return entry
      })()
    }
    if (args.action === 'search') return this.semantic?.enabled ? this.semanticSearch(args.query) : { mode: 'fts5', entries: store.recall(args.query, { k: 5, scope: 'all' }) }
    if (args.action === 'recall') {
      this.profile ??= new ProfileStore({ dbFile: join(this.directory, 'agent-notes.sqlite'), maxEntries: 2000 })
      // Use the original grounded-name and contextual-keyword gates. The
      // immutable per-turn host snapshot remains the final byte budget.
      const facts = selectProfileFacts(this.profile.listForPrompt(), { userMessage: args.query })
      const profile = facts.slice(0, 3).map(fact => ({ id: `profile:${fact.id}`, content: `${fact.key}: ${fact.value}`, sessionId: `personal-profile:${fact.id}:${fact.validFrom}` }))
      return this.semantic?.enabled ? this.semanticSearch(args.query).then(result => ({ ...result, entries: [...profile, ...result.entries] })) : { mode: 'profile+fts5', entries: [...profile, ...store.recall(args.query, { k: 5, scope: 'all' })] }
    }
    if (args.action === 'list') return store.listIndex({ limit: 100, scope: 'all' })
    if (!Number.isSafeInteger(args.id) || args.id < 1) throw new Error('A positive note id is required')
    if (args.action === 'get') return store.get(args.id)
    if (args.action === 'forget') {
      const db = this.provenanceDatabase()
      return db.transaction(() => {
        const removed = store.remove(args.id)
        db.prepare('DELETE FROM atomic_note_provenance WHERE note_id = ?').run(args.id)
        return { removed }
      })()
    }
    throw new Error('Unknown notes action')
  }
  maintenanceStores() {
    const options = { dbFile: join(this.directory, 'agent-notes.sqlite'), maxEntries: 2000 }
    this.links ??= new LinkStore({ db: this.database().getDatabaseHandleForEmbeddings() })
    this.lessons ??= new LessonStore(options)
    this.procedures ??= new ProcedureStore(options)
    return { memoryStore: this.database(), linkStore: this.links, lessonStore: this.lessons, procedureStore: this.procedures }
  }
  async recallWithContext(args) {
    let query = args.query
    if (this.queryRewriteEnabled && this.queryRewriter && typeof args.history === 'string' && args.history.length <= 4000) {
      try {
        const history = JSON.parse(args.history)
        if (Array.isArray(history) && history.length <= 8 && history.every(row => ['user','assistant'].includes(row.role) && typeof row.text === 'string' && row.text.length <= 400)) {
          query = await this.queryRewriter.maybeRewrite({ sessionId: args.sessionId ?? 'personal-recall', userMessage: args.query, history, signal: AbortSignal.timeout(500) })
        }
      } catch { /* A malformed or slow rewrite retains the raw query. */ }
    }
    return this.call({ ...args, query, action: 'recall' })
  }
  configureSemantic(config) {
    this.semantic = semanticMemory(this.database(), config)
    return this.semantic
  }
  async semanticSearch(query) {
    return { mode: this.semantic?.enabled ? 'hybrid-with-keyword-fallback' : 'fts5', entries: await this.database().recallHybridAsync(query, { k: 5, scope: 'all' }) }
  }
  async indexSemantic() {
    if (!this.semantic?.enabled) throw new Error('Semantic memory is disabled')
    let indexed = 0
    // Explicit bounded backfill; existing notes and source references stay intact.
    for (const row of this.database().listIndex({ limit: 100, scope: 'all' })) {
      const entry = this.database().get(row.id)
      if (entry && await this.database().writeEmbeddingFor(entry.id, entry.content)) indexed++
    }
    return { indexed, limit: 100 }
  }
  knowledge(args) {
    const store = this.database()
    const options = { dbFile: join(this.directory, 'agent-notes.sqlite'), maxEntries: 2000 }
    if (args.area === 'profile') {
      this.profile ??= new ProfileStore(options)
      if (args.action === 'list') {
        const facts = this.profile.list()
        return { facts: facts.slice(0, 50).map(fact => ({ ...fact, value: fact.value.slice(0, 240), preview: fact.value.length > 240 })), total: facts.length, truncated: facts.length > 50 }
      }
      if (args.action === 'search') {
        if (typeof args.query !== 'string' || !args.query.trim()) throw new Error('A profile search query is required')
        const terms = [...new Set(args.query.trim().toLowerCase().split(/\s+/u))]
        const facts = this.profile.list().filter(fact => {
          const fields = [fact.key, fact.value, ...(fact.keywords ?? [])].map(value => value.toLowerCase())
          return terms.every(term => fields.some(value => value.includes(term)))
        })
        return { mode: 'profile-substring-all-terms', facts: facts.slice(0, 50), total: facts.length, truncated: facts.length > 50 }
      }
      // IDs returned by save/list are accepted for reads; mutation still
      // requires an explicit key so an old historical ID cannot delete a
      // different active version accidentally.
      if (args.action === 'get' && Number.isSafeInteger(args.id) && !args.key) return this.profile.getById(args.id)
      const key = args.key ?? (args.action === 'history' && Number.isSafeInteger(args.id) ? this.profile.getById(args.id)?.key : undefined)
      if (typeof key !== 'string' || !key.trim()) throw new Error('A profile key is required (get/history also accept a fact id)')
      if (args.action === 'get') return this.profile.get(key)
      if (args.action === 'history') {
        const facts = this.profile.history(key)
        return { facts: facts.slice(-20), total: facts.length, truncated: facts.length > 20 }
      }
      if (args.action === 'forget') return { removed: this.profile.remove(key) }
      if (args.action === 'save') {
        // Preserve an explicit source note before any profile write. A failed
        // profile write can leave an audit note, never an untraceable fact.
        const evidence = this.call({ action: 'save', text: `Profile ${args.key}: ${args.text}`, sourceReference: args.sourceReference ?? args.source, sessionId: args.sessionId, tags: ['profile-evidence'] })
        return { fact: this.profile.set(args.key, args.text), evidenceNoteId: evidence.id }
      }
    } else if (args.area === 'links') {
      if (args.entityType === 'profile') {
        this.profile ??= new ProfileStore(options)
        return new ProfileLinks(store.getDatabaseHandleForEmbeddings(), this.profile).call(args)
      }
      if (args.entityType !== undefined && args.entityType !== 'note') throw new Error('Link entityType must be note or profile')
      if (args.action !== 'list') {
        for (const id of [args.id, ...(args.action === 'get' ? [] : [args.targetId])]) {
          if (!Number.isSafeInteger(id) || !store.get(id)) throw new Error('An existing note id is required; use entityType: profile for profile fact IDs')
        }
      }
      this.links ??= new LinkStore({ db: store.getDatabaseHandleForEmbeddings() })
      if (args.action === 'list') return this.links.listAll({ limit: 100 })
      if (args.action === 'get') return this.links.expand([args.id], { depth: 2, maxExpanded: 50 })
      if (args.action === 'save') return this.links.add({ fromId: args.id, toId: args.targetId, kind: args.kind })
      if (args.action === 'forget') return { removed: this.links.remove(args.id, args.targetId, args.kind) }
    } else if (args.area === 'lessons' || args.area === 'procedures') {
      const isLesson = args.area === 'lessons'
      const domain = isLesson ? (this.lessons ??= new LessonStore(options)) : (this.procedures ??= new ProcedureStore(options))
      if (args.action === 'list') return domain.listIndex({ limit: 100 })
      if (args.action === 'history') {
        if (!Number.isSafeInteger(args.id) || args.id < 1) throw new Error('A positive integer history id is required')
        const entry = domain.getById(args.id)
        if (!entry) return { scope: 'lifecycle', found: false, reason: 'not_found', entry: null, events: [] }
        // These records retain their content on deprecation, but do not
        // version arbitrary edits. Report only lifecycle events we can prove.
        const events = [{ action: 'created', at: entry.createdAt }]
        if (entry.deprecatedAt !== null) events.push({ action: 'deprecated', at: entry.deprecatedAt })
        return { scope: 'lifecycle', found: true, entry, events }
      }
      if (args.action === 'get') return domain.getById(args.id)
      if (args.action === 'search') return domain.recall({ query: args.query, k: 20 })
      if (args.action === 'save') {
        const sourceNoteId = args.sourceNoteId ?? args.id
        const parentLessonId = args.parentLessonId ?? args.targetId
        if (!Number.isSafeInteger(sourceNoteId) || !store.get(sourceNoteId)) throw new Error('An existing sourceNoteId is required (legacy alias: id)')
        if (!isLesson) {
          this.lessons ??= new LessonStore(options)
          if (!Number.isSafeInteger(parentLessonId) || !this.lessons.getById(parentLessonId)) throw new Error('An existing parentLessonId is required for a procedure (legacy alias: targetId)')
        }
        return isLesson
          ? domain.create({ activation: args.activation, principle: args.text, parentIds: [sourceNoteId], workingDir: this.workspace })
          : domain.create({ activation: args.activation, steps: (args.steps ?? []).map(description => ({ description, toolHint: null })), parentLessonIds: [parentLessonId], parentMemoryIds: [sourceNoteId], source: 'manual', workingDir: this.workspace })
      }
      if (args.action === 'forget') return { deprecated: domain.markDeprecated(args.id, 'Explicit Personal Chat tool request') }
    }
    throw new Error('Unsupported knowledge area/action')
  }
  close() {
    for (const store of [this.profile, this.lessons, this.procedures, this.store]) store?.close()
  }
}
