import { createReflectionRunner } from './agent-source/suite/memory/reflection/reflection-runner.mjs'
import { ProfileStore } from './agent-source/memory/profile-store.mjs'
import { join } from 'node:path'

/** Source reflection, owned by Chat's idle/background lifecycle. No Agent
 * runtime is started. Foreground chat and context recovery always win. */
export class PersonalMemoryLifecycle {
  constructor({ directory, notes, complete, now = () => Date.now() }) {
    this.now = now
    this.notes = notes
    this.profile = new ProfileStore({ dbFile: join(directory, 'agent-notes.sqlite'), maxEntries: 500 })
    this.pending = []
    this.records = new Map()
    this.busy = true
    this.enabled = true
    this.runner = createReflectionRunner({ llmComplete: complete,
      toolTransport: 'native_tools', profileStore: this.profile,
      memoryStore: notes.database(), reflectionSlotId: -1,
      timeoutMs: 60000, maxFactsPerCall: 3, maxNotesPerCall: 2,
      emitTrace: event => {
        if (!this.active) return
        this.active.outcome = event.outcome
        this.active.factsWritten = event.factsWritten ?? 0
        this.active.notesWritten = event.notesWritten ?? 0
        this.active.reason = event.reason
      }, now })
  }
  enqueue(input) {
    for (const key of ['sessionId', 'messageId', 'userMessage', 'assistantReply']) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`Missing reflection ${key}`)
    }
    if (input.sessionId.length > 200 || input.messageId.length > 200) throw new Error('Reflection identity is too long')
    const key = `${input.sessionId}:${input.messageId}`
    if (this.records.has(key)) return this.status()
    // Match the original end-of-turn best-effort posture. Bound pending
    // work; an old observation never blocks delivery of a current answer.
    if (this.pending.length >= 32) throw new Error('Memory observation queue is full')
    const row = { key, input: { sessionId: input.sessionId, userMessage: input.userMessage.slice(0, 10000), assistantReply: input.assistantReply.slice(0, 10000) }, state: 'queued', createdAt: this.now() }
    this.records.set(key, row)
    this.pending.push(row)
    this.trim()
    return this.status()
  }
  trim() {
    for (const [key, row] of this.records) {
      if (this.records.size <= 100) break
      if (!['queued', 'running'].includes(row.state)) this.records.delete(key)
    }
  }
  activity(busy) {
    this.busy = busy
    if (busy) this.runner.abortPending()
    else void this.drain()
    return this.status()
  }
  status() {
    const row = this.active ?? [...this.records.values()].at(-1)
    return { enabled: this.enabled, phase: this.active ? (this.busy ? 'paused' : 'running') : this.pending.length ? 'queued' : row?.state ?? 'idle', queued: this.pending.length,
      last: row ? { key: row.key, state: row.state, outcome: row.outcome, factsWritten: row.factsWritten, notesWritten: row.notesWritten, reason: row.reason } : null }
  }
  async drain() {
    if (this.closed || this.busy || !this.enabled || this.active) return
    const row = this.pending.shift()
    if (!row) return
    this.active = row
    row.state = 'running'
    try {
      await this.runner.reflect(row.input)
      if (row.outcome === 'aborted' && this.busy && !this.closed) {
        row.state = 'queued'
        this.pending.unshift(row)
      } else row.state = ['ok', 'none'].includes(row.outcome) ? 'completed' : 'failed'
    } finally {
      this.active = null
      this.trim()
      if (!this.busy && !this.closed) void this.drain()
    }
  }
  async close() {
    this.closed = true
    this.runner.abortPending()
    // Reflection owns the database until its aborted promise settles.
    while (this.active) await new Promise(resolve => setTimeout(resolve, 10))
    this.profile.close()
  }
}
