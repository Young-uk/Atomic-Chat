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
  call(args) {
    const store = this.database()
    if (args.action === 'save') {
      if (typeof args.source !== 'string' || !args.source.trim() || args.source.length > 2000) throw new Error('A verifiable source reference is required')
      return store.store({ content: args.text, tags: args.tags, source: 'user', sessionId: args.source, workingDir: this.workspace })
    }
    if (args.action === 'search') return { mode: 'fts5', entries: store.recall(args.query, { k: 5, scope: 'all' }) }
    if (args.action === 'recall') {
      this.profile ??= new ProfileStore({ dbFile: join(this.directory, 'agent-notes.sqlite'), maxEntries: 2000 })
      // Use the original grounded-name and contextual-keyword gates. The
      // immutable per-turn host snapshot remains the final byte budget.
      const facts = selectProfileFacts(this.profile.listForPrompt(), { userMessage: args.query })
      const profile = facts.slice(0, 3).map(fact => ({ id: `profile:${fact.id}`, content: `${fact.key}: ${fact.value}`, sessionId: `personal-profile:${fact.id}:${fact.validFrom}` }))
      return { mode: 'profile+fts5', entries: [...profile, ...store.recall(args.query, { k: 5, scope: 'all' })] }
    }
    if (args.action === 'list') return store.listIndex({ limit: 100, scope: 'all' })
    if (!Number.isSafeInteger(args.id) || args.id < 1) throw new Error('A positive note id is required')
    if (args.action === 'get') return store.get(args.id)
    if (args.action === 'forget') return { removed: store.remove(args.id) }
    throw new Error('Unknown notes action')
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
      if (typeof args.key !== 'string' || !args.key.trim()) throw new Error('A profile key is required')
      if (args.action === 'get') return this.profile.get(args.key)
      if (args.action === 'history') {
        const facts = this.profile.history(args.key)
        return { facts: facts.slice(-20), total: facts.length, truncated: facts.length > 20 }
      }
      if (args.action === 'forget') return { removed: this.profile.remove(args.key) }
      if (args.action === 'save') {
        // Preserve an explicit source note before any profile write. A failed
        // profile write can leave an audit note, never an untraceable fact.
        const evidence = this.call({ action: 'save', text: `Profile ${args.key}: ${args.text}`, source: args.source, tags: ['profile-evidence'] })
        return { fact: this.profile.set(args.key, args.text), evidenceNoteId: evidence.id }
      }
    } else if (args.area === 'links') {
      this.links ??= new LinkStore({ db: store.getDatabaseHandleForEmbeddings() })
      if (args.action === 'list') return this.links.listAll({ limit: 100 })
      if (args.action === 'get') return this.links.expand([args.id], { depth: 2, maxExpanded: 50 })
      if (args.action === 'save') return this.links.add({ fromId: args.id, toId: args.targetId, kind: args.kind })
      if (args.action === 'forget') return { removed: this.links.remove(args.id, args.targetId, args.kind) }
    } else if (args.area === 'lessons' || args.area === 'procedures') {
      const isLesson = args.area === 'lessons'
      const domain = isLesson ? (this.lessons ??= new LessonStore(options)) : (this.procedures ??= new ProcedureStore(options))
      if (args.action === 'list') return domain.listIndex({ limit: 100 })
      if (args.action === 'get') return domain.getById(args.id)
      if (args.action === 'search') return domain.recall({ query: args.query, k: 20 })
      if (args.action === 'save') {
        if (!Number.isSafeInteger(args.id) || !store.get(args.id)) throw new Error('An existing source note id is required')
        if (!isLesson) {
          this.lessons ??= new LessonStore(options)
          if (!Number.isSafeInteger(args.targetId) || !this.lessons.getById(args.targetId)) throw new Error('An existing parent lesson targetId is required for a procedure')
        }
        return isLesson
          ? domain.create({ activation: args.activation, principle: args.text, parentIds: [args.id], workingDir: this.workspace })
          : domain.create({ activation: args.activation, steps: (args.steps ?? []).map(description => ({ description, toolHint: null })), parentLessonIds: [args.targetId], parentMemoryIds: [args.id], source: 'manual', workingDir: this.workspace })
      }
      if (args.action === 'forget') return { deprecated: domain.markDeprecated(args.id, 'Explicit Personal Chat tool request') }
    }
    throw new Error('Unsupported knowledge area/action')
  }
  close() {
    for (const store of [this.profile, this.lessons, this.procedures, this.store]) store?.close()
  }
}
