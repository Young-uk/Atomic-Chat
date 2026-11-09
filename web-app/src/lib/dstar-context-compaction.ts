import { invoke } from '@tauri-apps/api/core'
import { renderOpenRequests, type RequestLedger } from './dstar-open-requests'
import type { SummaryProgress, SummaryInputProgress } from './context-summary-progress'
import type { UIMessage } from 'ai'
import { estimateTokens } from './prompt-size'
import { prepareToolResultImagesForModel } from './toolResultImages'
import { messageClockLabel } from './messageClock'

/** Persist count-only diagnostics in the existing application log on desktop. */
export function logCompactionBudget(event: string, fields: Record<string, unknown>): void {
  console.info(`[context-compaction] ${event}`, fields)
  if (IS_TAURI) {
    void invoke('plugin:log|log', { level: 3,
      message: `[context-compaction] ${event} ${JSON.stringify(fields)}`,
      location: 'context-compaction' }).catch(() => {})
  }
}

export const COMPACTION_TRIGGER = 0.7
export const RECENT_CONTEXT_FRACTION = 0.2
export const COMPACTION_TARGET = 0.5
export const PROMPT_PRESSURE_TRIGGER = 0.85

export type SummaryCheckpoint = {
  version: 1
  inputKey: string
  offset: number
  completed: number
  summary: string
  requests?: RequestLedger
}

export type SummaryBatch = { id: string; summary: string; sourceEndId: string }

export type ArchiveRecord = {
  version: 1
  id: string
  threadId: string
  /** Provider, endpoint, model and runtime identity; absent in legacy archives. */
  runtimeScope?: string
  source: UIMessage[]
  previousSummary: string
  /** Stable insertion boundary after retained completed dialogue. */
  summaryAfterMessageId?: string
  summaryFallbackAfterMessageId?: string
  /** Keep an earlier raw prefix for cache alignment; summary evidence stays exact. */
  cacheRetainFrom?: number
  createdAt?: number
  summary?: string
  requests?: RequestLedger
  checkpoint?: SummaryCheckpoint
  /** Independent chronological summaries; old archives migrate as one batch. */
  batches?: SummaryBatch[]
  /** Preserve pre-consolidation summaries alongside the original source. */
  extractedBatches?: SummaryBatch[]
  batchStart?: number
  /** Persist scheduling evidence without storing another copy of chat text. */
  trigger?: {
    reason: 'raw-history' | 'prompt-pressure' | 'recovery' | 'resume'
    context: number
    rawTokens: number
    rawThreshold: number
    promptTokens: number
    pressureThreshold: number
    tokenizer: boolean
    measuredAt: number
  }
}

export interface ContextArchiveStore {
  /** Must persist and verify the exact source before resolving. */
  save(record: ArchiveRecord): Promise<void>
  load(threadId: string): Promise<ArchiveRecord | undefined>
  loadCandidates?(threadId: string): Promise<ArchiveRecord[]>
  loadPending?(threadId: string): Promise<ArchiveRecord | undefined>
}

const volatileMetadata = new Set(['activityDurationMs', 'finishReason', 'modelId', 'providerId', 'tokenSpeed', 'ttftMs', 'usage', 'contextUsage', 'contextUsageScope'])
function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  return value
}
/** SDK streaming state, root timestamps and performance metadata are not model
 * context. Compare semantic content across persistence/reload, while retaining
 * the exact unmodified source in the archive. User whitespace remains exact. */
const fingerprint = (messages: UIMessage[]) => JSON.stringify(stable(messages.map(m => ({
  id: m.id, role: m.role,
  parts: m.parts.map(p => p.type === 'text' || p.type === 'reasoning'
    ? { type: p.type, text: m.role === 'assistant' ? p.text.trim() : p.text } : p),
  metadata: Object.fromEntries(Object.entries((m.metadata ?? {}) as Record<string, unknown>)
    .filter(([key]) => !volatileMetadata.has(key))),
}))))
export { fingerprint as contextSourceFingerprint }

const cost = (messages: UIMessage[]) => messages.length === 0 ? 0 : estimateTokens(JSON.stringify(prepareToolResultImagesForModel(messages, { supportsVision: false }).map(({ role, parts }) => ({ role, parts }))))

/** Keep complete user turns, including every tool call/result in that turn.
 * The newest user turn is always retained, even when it exceeds the target. */
export function compactionBoundary(messages: UIMessage[], context: number): number {
  let retained = 0
  let boundary = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    retained += cost([messages[i]])
    if (messages[i].role === 'user') {
      boundary = i
      if (retained >= context * RECENT_CONTEXT_FRACTION) break
    }
  }
  // Never archive leading instructions or a fragment before the first turn.
  return boundary > 0 && messages.slice(0, boundary).some(m => m.role === 'user')
    ? boundary : 0
}

/** Only user-visible text and actual tool records are summarization evidence.
 * Preserve the complete source, including private reasoning, in the archive;
 * do not turn speculative private reasoning into remembered facts. */
export function summaryEvidence(messages: UIMessage[]): string {
  // Image bytes are archived, not textual evidence for the summary model.
  return JSON.stringify(prepareToolResultImagesForModel(messages, { supportsVision: false }).map(m => ({
    id: m.id, role: m.role,
    // Repeated hidden tool catalogs can dwarf the actual dialogue. Preserve
    // them in the original archive, never repeat them as summary evidence.
    metadata: Object.fromEntries(Object.entries((m.metadata ?? {}) as Record<string, unknown>)
      .filter(([key]) => key === 'message_clock' || key === 'turn_error')),
    parts: m.parts.filter(p => p.type !== 'reasoning').map(p => p.type === 'file'
      ? { type: 'file', mediaType: p.mediaType, filename: p.filename,
          note: 'Attachment preserved in the original archive; its contents were not summarized.' }
      : p),
  })))
}

/** Prefer actual previous request usage when available. A compacted view
 * deliberately drops those old measurements until the new prompt is measured. */
export function estimateConversationUsage(messages: UIMessage[], heuristic: number): number {
  if (messages.some(m => m.id.startsWith('atomic-context-'))) return heuristic
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i].metadata as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined
    const usage = metadata?.usage
    if (messages[i].role === 'assistant' && typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens)) {
      return usage.inputTokens + (usage.outputTokens ?? 0) + cost(messages.slice(i + 1))
    }
  }
  return heuristic
}

/** Keep all existing model sanitizers in force. The sole new message is our
 * generated summary; an omitted failed/agent-only turn must not be resurrected. */
export function projectCompactedMessages(view: UIMessage[], prepared: UIMessage[]): UIMessage[] {
  const byId = new Map(prepared.map(m => [m.id, m]))
  return view.flatMap(m => {
    const existing = byId.get(m.id)
    // Tool images are derived model-only messages. Keep them only when their
    // owning source turn survives compaction; they are not separate history.
    const toolImage = byId.get(`${m.id}_toolimg`)
    const owned = prepared.filter(candidate =>
      (candidate.metadata as Record<string, unknown> | undefined)?.atomic_tool_image_owner === m.id)
    return owned.length ? owned : existing ? [existing, ...(toolImage ? [toolImage] : [])]
      : m.role === 'system' && m.id.startsWith('atomic-context-') ? [m] : []
  })
}

export type Summarize = ((previous: string, evidence: string, signal: AbortSignal, progress?: (completed: number, paused?: boolean) => void, checkpoints?: { resume?: SummaryCheckpoint; save: (checkpoint: SummaryCheckpoint) => Promise<void>; requestSources?: UIMessage[]; previousRequests?: RequestLedger }) => Promise<string>) & {
  cached?: boolean
  selectBoundary?(messages: UIMessage[], boundary: number, archived: number, signal: AbortSignal): Promise<number>
  countRawTokens?(messages: UIMessage[], signal: AbortSignal): Promise<number>
  recoveryPriority?: boolean
  batches?: {
    countRawTokens?(messages: UIMessage[], signal: AbortSignal): Promise<number>
    selectCompletePrefix(messages: UIMessage[], requests: RequestLedger | undefined, signal: AbortSignal): Promise<number>
    consolidate(batches: SummaryBatch[], requests: RequestLedger | undefined, signal: AbortSignal): Promise<SummaryBatch[]>
  }
}

/** A per-thread state machine. No history/UI deletion and no inference awaited
 * on the foreground path. A completed snapshot is applied only by the next
 * request, so an active stream and its tool continuation remain immutable. */
export class ContextCompaction {
  private active?: ArchiveRecord
  private resumable?: ArchiveRecord
  private pending?: { record: ArchiveRecord; sourceKey: string; controller: AbortController; recovery?: boolean; inputProgress?: (input?: SummaryInputProgress) => void }
  private ready?: { record: ArchiveRecord; sourceKey: string }
  private archiveCandidates: ArchiveRecord[] = []
  private initialization?: Promise<void>
  private pendingCompletion?: Promise<void>
  private batchWaiters = new Set<() => void>()

  /** A late stream may only update its own still-pending summary task. */
  reportInput(signal: AbortSignal, input?: SummaryInputProgress): void {
    if (!signal.aborted && this.pending?.controller.signal === signal) this.pending.inputProgress?.(input)
  }

  private notifyBatch(): void {
    for (const notify of this.batchWaiters) notify()
  }

  private preview(record: ArchiveRecord, messages: UIMessage[]): UIMessage[] {
    // Preview on an isolated coordinator so an in-flight tool request keeps
    // its original active summary and placement anchors.
    const preview = new ContextCompaction(this.threadId, { load: async () => undefined, save: async () => {} })
    preview.active = structuredClone(record)
    return preview.apply(messages)
  }
  /** Inspect the next-turn view without adopting it into an in-flight request. */
  previewReady(messages: UIMessage[]): UIMessage[] {
    const record = this.ready?.record ?? this.active
    return record && this.matches(record, messages) ? this.preview(record, messages) : messages
  }
  error?: string

  constructor(private threadId: string, private store: ContextArchiveStore,
    private onProgress?: (progress?: SummaryProgress) => void) {}

  setProgressListener(listener: (progress?: SummaryProgress) => void): void {
    this.onProgress = listener
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (this.store.loadCandidates
        ? this.store.loadCandidates(this.threadId)
        : this.store.load(this.threadId).then(record => record ? [record] : [])).then(records => {
        this.archiveCandidates = records
        const record = records[0]
        if (record?.summary?.trim()) this.active = record
        return this.store.loadPending?.(this.threadId).then(pending => { this.resumable = pending })
      }).catch(error => { this.initialization = undefined; throw error })
    }
    return this.initialization
  }

  private matches(record: ArchiveRecord, messages: UIMessage[]): boolean {
    return record.threadId === this.threadId &&
      fingerprint(messages.slice(0, record.source.length)) === fingerprint(record.source)
  }

  /** Recheck a completed clone against the latest foreground cache. The source
   * is immutable evidence: choosing an earlier turn retains overlapping raw
   * dialogue rather than pretending the summary covered a different segment.
   * This runs before a new user request, never during its tool continuation. */
  async prepareCachedAdoption(messages: UIMessage[],
    select: (messages: UIMessage[], boundary: number, archived: number, signal: AbortSignal) => Promise<number>,
    signal: AbortSignal): Promise<void> {
    const ready = this.ready
    if (!ready || this.pending || !this.matches(ready.record, messages) ||
        !ready.record.checkpoint?.inputKey.startsWith(`${this.threadId}/`)) return
    const record = ready.record
    const boundary = record.cacheRetainFrom ?? record.source.length
    const archived = this.active?.source.length ?? 0
    const selected = await select(messages, boundary, archived, signal)
    signal.throwIfAborted()
    if (this.ready !== ready || !this.matches(record, messages)) return
    if (!Number.isSafeInteger(selected) || selected <= archived || selected > boundary ||
        (selected !== boundary && messages[selected]?.role !== 'user')) return
    logCompactionBudget('cached handoff boundary checked', {
      threadId: this.threadId, sourceMessages: record.source.length,
      retainedFrom: selected, additionalRawMessages: record.source.length - selected,
    })
    if (selected === boundary) return
    const updated = { ...record, cacheRetainFrom: selected }
    await this.store.save(updated)
    signal.throwIfAborted()
    if (this.ready === ready && this.matches(record, messages)) ready.record = updated
  }

  /** Caller invokes this only at a new user turn, never mid tool execution. */
  apply(messages: UIMessage[], allowNewSummary = true): UIMessage[] {
    if (this.ready && allowNewSummary) {
      if (fingerprint(messages.slice(0, this.ready.record.source.length)) === this.ready.sourceKey) {
        this.active = this.ready.record
      }
      this.ready = undefined
    }
    if (this.pending && fingerprint(messages.slice(0, this.pending.record.source.length)) !== this.pending.sourceKey) {
      this.pending.controller.abort()
    }
    if (this.active && !this.matches(this.active, messages)) this.active = undefined
    // A longer legacy snapshot can be incompatible after a transcript edit.
    // Do not let it hide a shorter independently saved, matching checkpoint.
    if (!this.active) this.active = this.archiveCandidates.find(record => this.matches(record, messages))
    if (!this.active) return messages
    const archived = this.active
    const overlap = archived.cacheRetainFrom
    const retainFrom = typeof overlap === 'number' && Number.isSafeInteger(overlap) && overlap > 0 && overlap <= archived.source.length &&
      messages[overlap]?.role === 'user' ? overlap : archived.source.length
    const retained = messages.slice(retainFrom)
    if (!archived.summaryAfterMessageId) {
      // Legacy archives acquire a boundary once, before the newest user turn.
      // Never move a summary past later turns on subsequent requests.
      const newestUser = retained.findLastIndex(m => m.role === 'user')
      const completed = newestUser >= 0 ? retained.slice(0, newestUser) : retained
      archived.summaryAfterMessageId = completed.at(-1)?.id ?? archived.source.at(-1)?.id
      void this.store.save({ ...archived }).catch(error => {
        this.error = `Summary placement could not be saved: ${error instanceof Error ? error.message : String(error)}`
      })
    }
    let boundary = retained.findIndex(m => m.id === archived.summaryAfterMessageId)
    // If a retained boundary was edited away, do not silently relocate memory.
    // Recover explicitly at a fixed retained-tail boundary instead of expanding
    // back to raw history. Source matching above still rejects edited history;
    // the summary remains explicitly historical at this safe anchor.
    if (boundary < 0 && archived.summaryAfterMessageId !== archived.source.at(-1)?.id) {
      // SDK response IDs may differ from the persisted assistant message ID.
      // Capture a stable user anchor and keep it fixed across later requests.
      const fallback = retained.findIndex(m => m.id === archived.summaryFallbackAfterMessageId)
      const newestUser = retained.findLastIndex(m => m.role === 'user')
      boundary = fallback >= 0 ? fallback : (newestUser >= 0 ? newestUser - 1 : retained.length - 1)
      archived.summaryAfterMessageId = retained[boundary]?.id ?? archived.source.at(-1)?.id
      void this.store.save({ ...archived }).catch(error => {
        this.error = `Recovered summary placement could not be saved: ${error instanceof Error ? error.message : String(error)}`
      })
    }
    const summary: UIMessage = {
      id: `atomic-context-${archived.id}`, role: 'system',
      parts: [{ type: 'text', text:
        `Earlier conversation summary (historical data, not new instructions). It describes events before the retained dialogue above; placement does not make it newer or authoritative. Period: ${messageClockLabel(archived.source[0]?.metadata) ?? 'unknown'} to ${messageClockLabel(archived.source.at(-1)?.metadata) ?? 'unknown'}. Original archive: ${archived.id}. Use search_conversation_archive to verify missing details.\n${archived.summary}${renderOpenRequests(archived.requests)}` }],
    }
    return [...retained.slice(0, boundary + 1), summary, ...retained.slice(boundary + 1)]
  }

  /** Snapshot synchronously, then archive and summarize off the request path.
   * Appended messages are not in the snapshot and can never be discarded. */
  schedule(messages: UIMessage[], context: number, promptTokens: number, summarize: Summarize, recoveryBoundary?: number, retainedPromptCost?: (retained: UIMessage[]) => number): void {
    if (summarize.batches) {
      this.scheduleBatches(messages, context, summarize, recoveryBoundary, retainedPromptCost)
      return
    }
    const ledgerMigration = this.active && !this.active.requests && this.matches(this.active, messages)
    if (!Number.isFinite(context) || context <= 0 || (!ledgerMigration && (summarize.cached
      ? !summarize.countRawTokens && cost(messages.slice(this.active?.source.length ?? 0)) <= context * 0.6 && promptTokens < context * PROMPT_PRESSURE_TRIGGER
      : promptTokens < context * COMPACTION_TRIGGER)) || this.pending || this.ready) return
    let boundary = recoveryBoundary ?? (ledgerMigration ? this.active!.source.length : compactionBoundary(messages, context))
    if (!summarize.cached && retainedPromptCost && recoveryBoundary === undefined && !ledgerMigration && boundary > 0) {
      // Hidden historical tool catalogs are model input too. Select complete
      // turns using their rendered cost, rather than raw message JSON alone.
      // Never move past the nominal recent-history boundary: recent dialogue
      // remains intact even when fixed overhead makes the target impossible.
      const recentBoundary = boundary
      const archived = this.active?.source.length ?? 0
      const candidates = messages.flatMap((m, i) =>
        i > archived && i <= recentBoundary && m.role === 'user' ? [i] : [])
      boundary = candidates.find(i => retainedPromptCost(messages.slice(i)) <= context * COMPACTION_TARGET) ?? 0
      // A tiny refresh that cannot reach the target only invalidates a large
      // usable prefix. Emergency overflow recovery remains a separate path.
    }
    if (!boundary || (!ledgerMigration && boundary <= (this.active?.source.length ?? 0))) return
    // A resumed snapshot keeps its exact evidence even if newer turns have
    // arrived. Those newer turns remain raw and can be summarized later.
    const resume = this.resumable && this.matches(this.resumable, messages) &&
      this.resumable.source.length <= boundary && (this.resumable.source.length > (this.active?.source.length ?? 0) || !!ledgerMigration) &&
      this.resumable.previousSummary === (this.active?.summary ?? '') ? this.resumable : undefined
    let source = JSON.parse(JSON.stringify(resume?.source ?? messages.slice(0, boundary))) as UIMessage[]
    const record: ArchiveRecord = resume ?? { version: 1, id: crypto.randomUUID(), threadId: this.threadId,
      source, previousSummary: this.active?.summary ?? '', createdAt: Date.now(),
      // A clone can finish after newer dialogue. Choose its insertion anchor
      // once on adoption so every retained completed turn precedes new memory.
      summaryAfterMessageId: summarize.cached ? undefined : (messages.at(-1)?.role === 'user' ? messages.at(-2) : messages.at(-1))?.id,
      summaryFallbackAfterMessageId: summarize.cached ? undefined : messages.findLast(m => m.role === 'user')?.id }
    const controller = new AbortController()
    const task = { record, sourceKey: fingerprint(source), controller, inputProgress: undefined as ((input?: SummaryInputProgress) => void) | undefined }
    this.pending = task
    this.error = undefined
    const progress: SummaryProgress = { phase: 'queued', startedAt: Date.now(), completed: 0, archived: false }
    const report = (phase: SummaryProgress['phase']) => {
      if (this.pending !== task || controller.signal.aborted) return
      progress.phase = phase
      this.onProgress?.({ ...progress })
    }
    task.inputProgress = input => { progress.input = input; report(input ? 'summarizing' : progress.phase) }
    report('queued')
    this.pendingCompletion = (async () => {
      try {
        if (summarize.cached && summarize.countRawTokens && recoveryBoundary === undefined && !ledgerMigration) {
          const rawTokens = await summarize.countRawTokens(messages.slice(this.active?.source.length ?? 0), controller.signal)
          controller.signal.throwIfAborted()
          if (rawTokens <= context * 0.6 && promptTokens < context * PROMPT_PRESSURE_TRIGGER) {
            this.onProgress?.(undefined)
            return
          }
        }
        if (summarize.cached && summarize.selectBoundary && !resume && !ledgerMigration) {
          const archived = this.active?.source.length ?? 0
          const selected = await summarize.selectBoundary(messages, boundary, archived, controller.signal)
          controller.signal.throwIfAborted()
          if (Number.isSafeInteger(selected) && selected > archived && selected <= boundary &&
              (selected === boundary || messages[selected]?.role === 'user')) {
            boundary = selected
            source = JSON.parse(JSON.stringify(messages.slice(0, boundary))) as UIMessage[]
            record.source = source
            task.sourceKey = fingerprint(source)
          }
        }
        await this.store.save(record)
        progress.archived = true
        report('summarizing')
        const oldCount = this.active?.requests && this.matches(this.active, messages) ? this.active.source.length : 0
        const summary = (await summarize(oldCount ? record.previousSummary : '', summaryEvidence(source.slice(oldCount)), controller.signal, (completed, paused) => {
          progress.completed = completed
          report(paused ? 'paused' : 'summarizing')
        }, { resume: record.checkpoint, requestSources: summarize.cached ? source.slice(oldCount) : source, previousRequests: this.active?.requests, save: async checkpoint => {
          // Persist each committed merge before the next inference request.
          // It is not a ready summary and must never replace live history.
          await this.store.save({ ...record, checkpoint })
          record.checkpoint = checkpoint
          this.resumable = record
        } })).trim()
        if (!summary || controller.signal.aborted) throw new Error('Conversation summary was empty or cancelled')
        record.summary = summary
        record.requests = record.checkpoint?.requests
        report('saving')
        await this.store.save(record)
        if (this.pending === task && !controller.signal.aborted) {
          this.ready = { record, sourceKey: task.sourceKey }
          progress.finishedAt = Date.now()
          report('ready')
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        progress.finishedAt = Date.now()
        report('failed')
      } finally {
        if (this.pending === task) {
          this.pending = undefined
          if (controller.signal.aborted) this.onProgress?.(undefined)
        }
      }
    })()
  }

  /** New raw-history policy. Summary text is excluded only from the 60%
   * trigger; foreground preflight still counts every actual prompt component.
   * A separate 85% envelope-pressure trigger includes fixed overhead and memory.
   * Each independently committed batch is durable before consolidation starts. */
  private scheduleBatches(messages: UIMessage[], context: number, summarize: Summarize, recoveryBoundary?: number, promptCost?: (view: UIMessage[]) => number): void {
    if (!Number.isFinite(context) || context <= 0 || this.pending || this.ready) {
      console.info('[context-compaction] scheduling deferred', {
        threadId: this.threadId, context, pending: !!this.pending, ready: !!this.ready,
      })
      return
    }
    const initial = this.active && this.matches(this.active, messages) ? this.active : undefined
    const archived = initial?.source.length ?? 0
    const emergency = recoveryBoundary !== undefined
    // Raw dialogue remains the normal trigger. Fixed instructions, tool
    // schemas and historical memory can fill the foreground window first;
    // count that complete envelope independently instead of waiting for overflow.
    const pressureCost = (record?: ArchiveRecord) => promptCost?.(record ? this.preview(record, messages) : messages) ?? 0
    const pressure = pressureCost(initial) >= context * PROMPT_PRESSURE_TRIGGER
    if (!emergency && !pressure && !initial?.extractedBatches && !summarize.batches?.countRawTokens && cost(messages.slice(archived)) <= context * 0.6) return
    const snapshot = structuredClone(messages)
    // A foreground tool continuation is never eligible. Scheduling normally
    // happens after its final answer; emergency recovery excludes newest user.
    const newest = snapshot.findLastIndex(m => m.role === 'user')
    const limit = emergency ? newest : snapshot.at(-1)?.role === 'assistant' ? snapshot.length : newest
    if (limit <= archived && !initial?.extractedBatches) return
    const controller = new AbortController()
    const planningRecord: ArchiveRecord = { version: 1, id: crypto.randomUUID(), threadId: this.threadId, source: snapshot.slice(0, limit), previousSummary: initial?.summary ?? '' }
    const task = { record: planningRecord, sourceKey: fingerprint(planningRecord.source), controller, recovery: emergency, inputProgress: undefined as ((input?: SummaryInputProgress) => void) | undefined }
    this.pending = task
    this.error = undefined
    const progress: SummaryProgress = { phase: 'queued', startedAt: Date.now(), completed: 0, archived: false }
    const report = (phase: SummaryProgress['phase']) => {
      if (this.pending !== task || controller.signal.aborted) return
      progress.phase = phase; this.onProgress?.({ ...progress })
    }
    task.inputProgress = input => { progress.input = input; report(input ? 'summarizing' : progress.phase) }
    report('queued')
    this.pendingCompletion = (async () => {
      let current = initial
      const rawCost = (view: UIMessage[]) => summarize.batches?.countRawTokens
        ? summarize.batches.countRawTokens(view, controller.signal) : Promise.resolve(cost(view))
      try {
        const rawTokens = await rawCost(snapshot.slice(archived))
        const trigger: NonNullable<ArchiveRecord['trigger']> = {
          reason: emergency ? 'recovery' : initial?.extractedBatches ? 'resume'
            : rawTokens > context * 0.6 ? 'raw-history' : 'prompt-pressure',
          context, rawTokens, rawThreshold: context * 0.6,
          promptTokens: pressureCost(initial), pressureThreshold: context * PROMPT_PRESSURE_TRIGGER,
          tokenizer: !!summarize.batches?.countRawTokens, measuredAt: Date.now(),
        }
        // Count only unarchived dialogue, using the running tokenizer when
        // available. Fixed instructions and historical summaries do not trigger extraction.
        if (!emergency && !initial?.extractedBatches) {
          console.info('[context-compaction] raw-history trigger', {
            threadId: this.threadId, rawTokens, threshold: context * 0.6,
            archivedMessages: archived, rawMessages: snapshot.length - archived,
            tokenizer: !!summarize.batches?.countRawTokens,
            promptTokens: pressureCost(initial), pressureThreshold: context * PROMPT_PRESSURE_TRIGGER,
            scheduled: rawTokens > context * 0.6 || pressure,
          })
          if (rawTokens <= context * 0.6 && !pressure) {
            this.onProgress?.(undefined)
            return
          }
        }
        if (current?.extractedBatches && (current.batches?.length ?? 0) >= 5) {
          const batches = await summarize.batches!.consolidate(current.extractedBatches, current.requests, controller.signal)
          current = { ...current, batches, extractedBatches: undefined,
            summary: batches.map((batch, index) => `Historical segment ${index + 1}:\n${batch.summary}`).join('\n\n') }
          await this.store.save(current)
          this.ready = { record: current, sourceKey: fingerprint(current.source) }
          this.notifyBatch()
        }
        do {
          controller.signal.throwIfAborted()
          const start = current?.source.length ?? 0
          if (start >= limit) break
          const count = await summarize.batches!.selectCompletePrefix(snapshot.slice(start, limit), current?.requests, controller.signal)
          const end = start + count
          const batches = current?.batches ?? (current?.summary ? [{ id: current.id, summary: current.summary, sourceEndId: current.source.at(-1)!.id }] : [])
          const pending = this.resumable
          const resume = pending?.batchStart === start && pending.source.length === end && this.matches(pending, snapshot) && pending.previousSummary === (current?.summary ?? '') ? pending : undefined
          const record: ArchiveRecord = resume ?? { version: 1, id: crypto.randomUUID(), threadId: this.threadId,
            source: snapshot.slice(0, end), previousSummary: current?.summary ?? '', batches, batchStart: start, createdAt: Date.now(), trigger,
            summaryAfterMessageId: snapshot.at(limit - 1)?.id,
            summaryFallbackAfterMessageId: snapshot.slice(0, limit).findLast(m => m.role === 'user')?.id }
          task.record = record
          // Match only this archived prefix; messages appended during extraction
          // remain raw and never get incorporated into the committed source.
          task.sourceKey = fingerprint(record.source)
          await this.store.save(record)
          progress.archived = true; report('summarizing')
          const segment = record.source.slice(start)
          const summary = (await summarize('', summaryEvidence(segment), controller.signal,
            (_n, paused) => report(paused ? 'paused' : 'summarizing'), {
              resume: record.checkpoint, requestSources: segment, previousRequests: current?.requests,
              save: async checkpoint => {
                await this.store.save({ ...record, checkpoint }); record.checkpoint = checkpoint; this.resumable = record
              },
            })).trim()
          if (!summary) throw new Error('Conversation summary was empty')
          controller.signal.throwIfAborted()
          record.requests = record.checkpoint?.requests ?? current?.requests
          record.batches = [...batches, { id: record.id, summary, sourceEndId: record.source.at(-1)!.id }]
          // Persist extraction separately so a failed consolidation resumes
          // from this checkpoint rather than generating the segment again.
          if (record.batches.length >= 5) record.extractedBatches = record.batches
          record.summary = record.batches.map((batch, index) => `Historical segment ${index + 1}:\n${batch.summary}`).join('\n\n')
          report('saving'); await this.store.save(record)
          current = record
          this.ready = { record, sourceKey: fingerprint(record.source) }
          progress.completed++; this.notifyBatch(); report('summarizing')
          if (record.batches.length >= 5) {
            // Publish the durable extraction before expensive consolidation.
            // Never mutate a record already adopted by a foreground request.
            const consolidated = { ...record, extractedBatches: undefined,
              batches: await summarize.batches!.consolidate(record.batches, record.requests, controller.signal) }
            consolidated.summary = consolidated.batches.map((batch, index) => `Historical segment ${index + 1}:\n${batch.summary}`).join('\n\n')
            controller.signal.throwIfAborted()
            await this.store.save(consolidated)
            current = consolidated
            this.ready = { record: consolidated, sourceKey: fingerprint(consolidated.source) }
            this.notifyBatch()
          }
          // One bounded extraction normally takes raw history below 60%. If
          // the backlog is larger, keep processing the frozen snapshot only.
        } while (current && current.source.length < limit && (emergency
          ? promptCost ? promptCost(this.preview(current, messages)) > context : current.source.length < recoveryBoundary!
          : await rawCost(snapshot.slice(current.source.length)) > context * 0.6 || pressureCost(current) >= context * PROMPT_PRESSURE_TRIGGER))
        console.info('[context-compaction] batches completed', {
          threadId: this.threadId, archivedMessages: current?.source.length ?? archived,
          completed: progress.completed, promptTokens: pressureCost(current),
        })
        progress.finishedAt = Date.now(); report('ready')
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        console.warn('[context-compaction] batches failed', { threadId: this.threadId, completed: progress.completed, error: this.error })
        progress.finishedAt = Date.now(); report('failed')
      } finally {
        if (this.pending === task) { this.pending = undefined; this.notifyBatch(); if (controller.signal.aborted) this.onProgress?.(undefined) }
      }
    })()
  }

  /** Emergency recovery is awaited only when the foreground prompt cannot fit.
   * Reuse an existing job, preserve raw archives, and never discard the newest turn. */
  async recover(messages: UIMessage[], context: number, summarize: Summarize, signal?: AbortSignal, overflowTokens = 0, promptCost?: (view: UIMessage[]) => number): Promise<void> {
    signal?.throwIfAborted()
    let lastBudget = ''
    const fits = () => {
      const record = this.ready?.record
      const matches = !!record && this.matches(record, messages)
      const inputTokens = matches && promptCost ? promptCost(this.preview(record!, messages)) : undefined
      const fits = matches && (inputTokens === undefined || inputTokens <= context)
      const budget = JSON.stringify([record?.id, matches, inputTokens, context, fits])
      if (budget !== lastBudget) {
        lastBudget = budget
        // Counts only: do not log transcript text or tool arguments.
        logCompactionBudget('recovery budget', {
          threadId: this.threadId, archivedMessages: record?.source.length ?? 0,
          summaryBatches: record?.batches?.length ?? 0, sourceMatches: matches,
          inputWithReserve: inputTokens, context, decision: fits ? 'resume' : 'wait',
        })
      }
      return fits
    }
    if (fits()) {
      // Recovery runs only before output begins. Commit the exact verified
      // view here, including for a tool continuation which normally freezes
      // its active summary. Otherwise the retry sends the old oversized view.
      this.apply(messages, true)
      return
    }
    if (summarize.recoveryPriority && this.pending && !this.pending.recovery) {
      // A user request now depends on this summary. Preserve completed batches,
      // settle the old native owner, then resume with the urgent request adapter.
      const completion = this.pendingCompletion
      this.pending.controller.abort(new DOMException('Promoting summary to recovery', 'AbortError'))
      await completion
      signal?.throwIfAborted()
    }
    if (this.ready && !this.pending && this.matches(this.ready.record, messages)) {
      this.active = this.ready.record
      this.ready = undefined
    }
    // The regular recent-history target ignores fixed prompt overhead (system
    // instructions and historical/current tool schemas). Once that overhead
    // fills the window, reusing the same archive boundary cannot free space.
    // Advance only across complete older user turns, never the newest turn.
    const archived = this.active?.source.length ?? 0
    let boundary = compactionBoundary(messages, context)
    const newest = messages.findLastIndex(message => message.role === 'user')
    const target = Math.max(0, overflowTokens) + (overflowTokens > 0 ? 1024 : 0)
    while (boundary <= archived || cost(messages.slice(archived, boundary)) < target) {
      const next = messages.findIndex((message, index) => index > Math.max(boundary, archived) && message.role === 'user')
      if (next < 0 || next > newest) break
      boundary = next
    }
    this.schedule(messages, context, context, summarize, boundary, promptCost)
    const completion = this.pending ? this.pendingCompletion : undefined
    if (!completion) throw new Error('No earlier complete turns are available to summarize')
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', aborted); this.batchWaiters.delete(changed) }
      const aborted = () => { cleanup(); reject(signal?.reason) }
      const changed = () => {
        if (fits()) { cleanup(); resolve() }
        else if (!this.pending) {
          cleanup()
          // A normal background snapshot may stop at 60% before the full
          // foreground envelope fits. Continue from its durable boundary.
          if (this.ready && !this.error) resolve()
          else reject(new Error(this.error ?? 'No verified recovery summary fits the context window'))
        }
      }
      signal?.addEventListener('abort', aborted, { once: true })
      this.batchWaiters.add(changed)
      completion.then(changed, error => { cleanup(); reject(error) })
      if (signal?.aborted) aborted()
      else changed()
    })
    signal?.throwIfAborted()
    if (!fits()) return this.recover(messages, context, summarize, signal, overflowTokens, promptCost)
    this.apply(messages, true)
  }

  cancel(): void {
    this.pending?.controller.abort()
    this.ready = undefined
  }

  get status(): 'summarizing' | 'ready' | 'idle' {
    return this.pending ? 'summarizing' : this.ready ? 'ready' : 'idle'
  }
}
