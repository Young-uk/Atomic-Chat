import { BackgroundReviewChannel, validateReviewEvidence } from './review-channel.mjs'
import { createLinkGeneratorRunner } from './agent-source/suite/memory/links/link-generator-runner.mjs'
import { ConsolidatorJob, DistillRunner } from './agent-source/suite/memory/consolidator/index.mjs'
import { USER_CONFIG_DEFAULTS } from './agent-source/suite/config/config-schema.mjs'
import { createReflectionRunner } from './agent-source/suite/memory/reflection/reflection-runner.mjs'
import { ProfileStore } from './agent-source/memory/profile-store.mjs'
import { join } from 'node:path'

/** Source reflection, owned by Chat's idle/background lifecycle. No Agent
 * runtime is started. Foreground chat and context recovery always win. */
export class PersonalMemoryLifecycle {
  constructor({ directory, notes, complete, now = () => Date.now() }) {
    this.now = now
    this.complete = complete
    this.maintenanceEnabled = false
    this.nextMaintenance = 0
    this.notes = notes
    this.profile = new ProfileStore({ dbFile: join(directory, 'agent-notes.sqlite'), maxEntries: 500 })
    this.review = new BackgroundReviewChannel({ notes, complete, profile: this.profile })
    this.linker = createLinkGeneratorRunner({ llmComplete: complete,
      linkStore: notes.maintenanceStores().linkStore, reflectionSlotId: -1, timeoutMs: 45000, maxLinksPerCall: 4 })
    this.pending = []
    this.records = new Map()
    this.busy = true
    this.enabled = true
    this.runner = createReflectionRunner({ llmComplete: params => this.active?.reflection !== undefined
      ? Promise.resolve({ content: this.active.reflection }) : complete(params),
      toolTransport: 'native_tools', profileStore: this.profile,
      memoryStore: notes.database(), reflectionSlotId: -1,
      timeoutMs: 60000, maxFactsPerCall: 3, maxNotesPerCall: 2,
      emitTrace: event => {
        if (!this.active || this.maintenanceController) return
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
    const row = { key, input: { sessionId: input.sessionId, messageId: input.messageId, userMessage: input.userMessage.slice(0, 10000), assistantReply: input.assistantReply.slice(0, 10000), cacheOwner: typeof input.cacheOwner === 'string' && /^[A-Za-z0-9_:/.-]{1,256}$/.test(input.cacheOwner) ? input.cacheOwner : undefined, evidence: validateReviewEvidence(input.evidence) }, state: 'queued', createdAt: this.now() }
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
    if (busy) { this.runner.abortPending(); this.review.abortPending(); this.maintenanceController?.abort(); this.linker.abortPending() }
    else void this.drain()
    return this.status()
  }
  status() {
    const row = this.active ?? [...this.records.values()].at(-1)
    return { review: { enabled: this.review.enabled }, maintenance: { enabled: this.maintenanceEnabled, running: !!this.maintenanceController, last: this.maintenanceResult ?? null }, enabled: this.enabled, phase: this.active ? (this.busy ? 'paused' : 'running') : this.pending.length ? 'queued' : row?.state ?? 'idle', queued: this.pending.length,
      last: row ? { key: row.key, state: row.state, outcome: row.outcome, factsWritten: row.factsWritten, notesWritten: row.notesWritten, reason: row.reason } : null }
  }
  configureReview(enabled) { this.review.configure(enabled) }
  reviewHistory() { return this.review.store.history() }
  undoReview(id) { return this.review.store.undo(id) }
  configureMaintenance(enabled) {
    this.maintenanceEnabled = enabled === true
    if (!enabled) { this.maintenanceController?.abort(); this.linker.abortPending() }
  }
  async maintain() {
    if (!this.maintenanceEnabled || this.closed || this.busy || this.active || this.pending.length || this.maintenanceController || this.now() < this.nextMaintenance) return
    const controller = this.maintenanceController = new AbortController()
    const config = USER_CONFIG_DEFAULTS.memory.consolidation
    try {
      // Reuse source defaults and stores; no second model or autonomous timer.
      const runner = new DistillRunner({ llmComplete: this.complete, slotId: -1, timeoutMs: config.distillTimeoutMs, withProcedure: true })
      const job = new ConsolidatorJob({ ...config, enabled: true, consolidationLeaseMs: USER_CONFIG_DEFAULTS.memory.evolution?.leaseMs ?? 60000 },
        { ...this.notes.maintenanceStores(), distillRunner: runner, now: this.now, workingDir: this.notes.workspace })
      this.maintenanceResult = await job.runOnce(controller.signal)
      this.nextMaintenance = this.now() + (controller.signal.aborted ? 60000 : config.intervalMs)
    } catch (error) {
      this.maintenanceResult = { outcome: 'failed', reason: error.message }
      this.nextMaintenance = this.now() + 60000
    } finally { this.maintenanceController = null; if (!this.busy) void this.drain() }
  }
  async drain() {
    if (this.closed || this.busy || !this.enabled || this.active) return
    const row = this.pending.shift()
    if (!row) { void this.maintain(); return }
    this.active = row
    row.state = 'running'
    try {
      let review
      if (this.review.eligible(row.input)) {
        review = await this.review.run(row.input)
        if (this.busy || this.closed) throw new Error('Background review interrupted')
        row.reflection = review.lines
      }
      await this.runner.reflect(row.input)
      if (review && !this.busy && !this.closed) row.review = this.review.store.apply(row.input, review.lessons)
      if (this.maintenanceEnabled && !this.busy && !this.closed && ['ok','none'].includes(row.outcome)) {
        const candidates = this.notes.database().recall(row.input.userMessage, { k: 8, scope: 'all' }).map(note => ({ id: note.id, body: note.content }))
        row.linksWritten = await this.linker.generate({ ...row.input, candidates })
      }
      if (row.outcome === 'aborted' && this.busy && !this.closed) {
        row.state = 'queued'
        this.pending.unshift(row)
      } else row.state = ['ok', 'none'].includes(row.outcome) ? 'completed' : 'failed'
    } catch (error) {
      if (this.busy && !this.closed) { row.state = 'queued'; this.pending.unshift(row) }
      else { row.state = 'failed'; row.reason = error.message }
    } finally {
      delete row.reflection
      this.active = null
      this.trim()
      if (!this.busy && !this.closed) void this.drain()
    }
  }
  async close() {
    this.closed = true
    this.runner.abortPending()
    this.review.abortPending()
    this.maintenanceController?.abort()
    this.linker.abortPending()
    // Reflection owns the database until its aborted promise settles.
    while (this.active || this.maintenanceController) await new Promise(resolve => setTimeout(resolve, 10))
    this.profile.close()
  }
}
