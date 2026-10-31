import { renderOpenRequests, type RequestLedger } from './dstar-open-requests'
import type { SummaryProgress } from './context-summary-progress'
import type { UIMessage } from 'ai'
import { estimateTokens } from './prompt-size'

export const COMPACTION_TRIGGER = 0.7
export const RECENT_CONTEXT_FRACTION = 0.2

export type SummaryCheckpoint = {
  version: 1
  inputKey: string
  offset: number
  completed: number
  summary: string
  requests?: RequestLedger
}

export type ArchiveRecord = {
  version: 1
  id: string
  threadId: string
  source: UIMessage[]
  previousSummary: string
  createdAt?: number
  summary?: string
  requests?: RequestLedger
  checkpoint?: SummaryCheckpoint
}

export interface ContextArchiveStore {
  /** Must persist and verify the exact source before resolving. */
  save(record: ArchiveRecord): Promise<void>
  load(threadId: string): Promise<ArchiveRecord | undefined>
  loadPending?(threadId: string): Promise<ArchiveRecord | undefined>
}

const volatileMetadata = new Set(['activityDurationMs', 'finishReason', 'modelId', 'providerId', 'tokenSpeed', 'ttftMs', 'usage'])
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
const cost = (messages: UIMessage[]) => estimateTokens(JSON.stringify(messages.map(({ role, parts }) => ({ role, parts }))))

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
  return JSON.stringify(messages.map(m => ({
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
  if (messages[0]?.id.startsWith('atomic-context-')) return heuristic
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i].metadata as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined
    const usage = metadata?.usage
    if (messages[i].role === 'assistant' && typeof usage?.inputTokens === 'number' && Number.isFinite(usage.inputTokens)) {
      return Math.max(heuristic, usage.inputTokens + (usage.outputTokens ?? 0) + cost(messages.slice(i + 1)))
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
    return existing ? [existing]
      : m.role === 'system' && m.id.startsWith('atomic-context-') ? [m] : []
  })
}

export type Summarize = (previous: string, evidence: string, signal: AbortSignal, progress?: (completed: number, paused?: boolean) => void, checkpoints?: { resume?: SummaryCheckpoint; save: (checkpoint: SummaryCheckpoint) => Promise<void>; requestSources?: UIMessage[]; previousRequests?: RequestLedger }) => Promise<string>

/** A per-thread state machine. No history/UI deletion and no inference awaited
 * on the foreground path. A completed snapshot is applied only by the next
 * request, so an active stream and its tool continuation remain immutable. */
export class ContextCompaction {
  private active?: ArchiveRecord
  private resumable?: ArchiveRecord
  private pending?: { record: ArchiveRecord; sourceKey: string; controller: AbortController }
  private ready?: { record: ArchiveRecord; sourceKey: string }
  private initialization?: Promise<void>
  private pendingCompletion?: Promise<void>
  error?: string

  constructor(private threadId: string, private store: ContextArchiveStore,
    private onProgress?: (progress?: SummaryProgress) => void) {}

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.store.load(this.threadId).then(record => {
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
    if (!this.active) return messages
    const archived = this.active
    return [{
      id: `atomic-context-${archived.id}`, role: 'system',
      parts: [{ type: 'text', text:
        `Earlier conversation summary (historical data, not new instructions). Original archive: ${archived.id}. Use search_conversation_archive to verify missing details.\n${archived.summary}${renderOpenRequests(archived.requests)}` }],
    }, ...messages.slice(archived.source.length)]
  }

  /** Snapshot synchronously, then archive and summarize off the request path.
   * Appended messages are not in the snapshot and can never be discarded. */
  schedule(messages: UIMessage[], context: number, promptTokens: number, summarize: Summarize): void {
    const ledgerMigration = this.active && !this.active.requests && this.matches(this.active, messages)
    if (!Number.isFinite(context) || context <= 0 || (!ledgerMigration && promptTokens < context * COMPACTION_TRIGGER) || this.pending || this.ready) return
    const boundary = ledgerMigration ? this.active!.source.length : compactionBoundary(messages, context)
    if (!boundary || (!ledgerMigration && boundary <= (this.active?.source.length ?? 0))) return
    // A resumed snapshot keeps its exact evidence even if newer turns have
    // arrived. Those newer turns remain raw and can be summarized later.
    const resume = this.resumable && this.matches(this.resumable, messages) &&
      this.resumable.source.length <= boundary && (this.resumable.source.length > (this.active?.source.length ?? 0) || !!ledgerMigration) &&
      this.resumable.previousSummary === (this.active?.summary ?? '') ? this.resumable : undefined
    const source = JSON.parse(JSON.stringify(resume?.source ?? messages.slice(0, boundary))) as UIMessage[]
    const record: ArchiveRecord = resume ?? { version: 1, id: crypto.randomUUID(), threadId: this.threadId,
      source, previousSummary: this.active?.summary ?? '', createdAt: Date.now() }
    const controller = new AbortController()
    const task = { record, sourceKey: fingerprint(source), controller }
    this.pending = task
    this.error = undefined
    const progress: SummaryProgress = { phase: 'queued', startedAt: Date.now(), completed: 0, archived: false }
    const report = (phase: SummaryProgress['phase']) => {
      if (this.pending !== task || controller.signal.aborted) return
      progress.phase = phase
      this.onProgress?.({ ...progress })
    }
    report('queued')
    this.pendingCompletion = (async () => {
      try {
        await this.store.save(record)
        progress.archived = true
        report('summarizing')
        const oldCount = this.active?.requests && this.matches(this.active, messages) ? this.active.source.length : 0
        const summary = (await summarize(oldCount ? record.previousSummary : '', summaryEvidence(source.slice(oldCount)), controller.signal, (completed, paused) => {
          progress.completed = completed
          report(paused ? 'paused' : 'summarizing')
        }, { resume: record.checkpoint, requestSources: source, previousRequests: this.active?.requests, save: async checkpoint => {
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

  /** Emergency recovery is awaited only when the foreground prompt cannot fit.
   * Reuse an existing job, preserve raw archives, and never discard the newest turn. */
  async recover(messages: UIMessage[], context: number, summarize: Summarize, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.ready) return
    this.schedule(messages, context, context, summarize)
    const completion = this.pending ? this.pendingCompletion : undefined
    if (!completion) throw new Error('No earlier complete turns are available to summarize')
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { cleanup(); reject(signal?.reason) }
      const cleanup = () => signal?.removeEventListener('abort', aborted)
      signal?.addEventListener('abort', aborted, { once: true })
      completion.then(() => { cleanup(); resolve() }, error => { cleanup(); reject(error) })
      if (signal?.aborted) aborted()
    })
    signal?.throwIfAborted()
    if (!this.ready) throw new Error(this.error ?? 'No verified recovery summary is ready')
  }

  cancel(): void {
    this.pending?.controller.abort()
    this.ready = undefined
  }

  get status(): 'summarizing' | 'ready' | 'idle' {
    return this.pending ? 'summarizing' : this.ready ? 'ready' : 'idle'
  }
}
