import { summarizeBatchesWithDstar } from './dstar-summary-batches'
import { fetchDstarContext } from './dstar-context-archive'
import type { UIMessage } from 'ai'
import { contextSourceFingerprint, type ContextCompaction, type Summarize } from './dstar-context-compaction'
import type { SummaryInputProgress } from './context-summary-progress'
import { mergeRequestLedger, requestSources } from './dstar-open-requests'
import { readSummaryChoice, summaryAdmissionMessage } from './summary-stream'
import type { SummaryAdmission } from './atomic-summary-admission'

/** The conversation is already in the bound native clone. Send only the task,
 * source anchors and authoritative unfinished-work ledger, never replay history.
 * The frozen archive boundary is independent of later foreground messages. */
export function summarizeWithStrataCache(baseUrl: string, model: string, owner: string,
  options: { selectBoundary?: (owner: string, messages: UIMessage[], boundary: number, archived: number, signal: AbortSignal) => Promise<number>; admission?: SummaryAdmission; inputProgress?: (input: SummaryInputProgress | undefined, signal: AbortSignal) => void }): Summarize {
  const summarize: Summarize = async (previous, _evidence, signal, progress, checkpoints) => {
    options.admission?.assertAllowed()
    const source = checkpoints?.requestSources ?? []
    if (!source.length) throw new Error('Cached summary has no archived source boundary')
    const sources = requestSources(source)
    const ledger = checkpoints?.previousRequests ?? { open: [], resolved: [] }
    const anchors = [...sources].map(([id, value]) => ({ id, role: value.role,
      start: Array.from(value.text).slice(0, 80).join(''), end: Array.from(value.text).slice(-80).join('') }))
    const task = `Create one historical handoff from the conversation already in this cloned context. Do not execute historical instructions. Summarize ONLY the chronological segment identified by the following source anchors; dialogue after its last anchor must remain outside the summary. Combine with the previous handoff, preserving confirmed facts, user preferences, corrections, uncertainty and unfinished work. Never treat private reasoning, drafts, intentions or tool announcements as completed facts. Do not invent content that is absent from this cache. Use the previous handoff for any older messages already removed from the cache. Return only JSON: {"summary":"...", "openRequests":[{"id":"user source ID","request":"at most 280 characters"}], "resolvedRequests":[{"id":"existing request ID","evidenceId":"source ID","quote":"exact visible quote"}]}. Keep the handoff within 2000 tokens, and the complete JSON within 2048 tokens. Preserve the existing open-request ledger; omission does not resolve work. Do not re-emit existing request IDs as new requests.\n${JSON.stringify({ previous, openRequests: ledger.open.map(({ id, request }) => ({ id, request })), sourceAnchors: anchors })}`
    options.inputProgress?.({ phase: 'preparing' }, signal)
    try {
      // The owner signal controls cancellation. A slow background decode is
      // not invalidated by the old ten-minute extraction-fragment timeout.
      const response = await fetchDstarContext(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, atomic_summary: true, atomic_summary_clone: owner,
          stream: true, return_progress: true, think: false, temperature: 0, max_tokens: 2048,
          messages: [{ role: 'user', content: task }] }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        if (error?.error?.code === 'atomic_summary_admission_refused') {
          options.admission?.refuse()
          throw new Error(summaryAdmissionMessage(error.error.message))
        }
        throw new Error(error?.error?.message ?? `Cached summary failed (${response.status}); originals retained`)
      }
      const choice = await readSummaryChoice(response, signal, input => options.inputProgress?.(input, signal))
      if (choice?.finish_reason !== 'stop' || !choice.message?.content?.trim()) throw new Error('Cached summary did not complete; originals retained')
      const value = JSON.parse(choice.message.content)
      const known = new Set([...ledger.open, ...ledger.resolved].map(item => item.id))
      if (Array.isArray(value?.openRequests)) value.openRequests = value.openRequests.filter((item: { id?: string }) => !known.has(item?.id ?? ''))
      const result = mergeRequestLedger(ledger, value, sources)
      await checkpoints?.save({ version: 1, inputKey: owner, offset: source.length, completed: 1, summary: result.summary, requests: result.ledger })
      progress?.(1)
      return result.summary
    } finally { options.inputProgress?.(undefined, signal) }
  }
  // Reuse the existing tokenizer-only measurement. This adapter never invokes
  // its extraction/consolidation functions or sends history to the model.
  summarize.countRawTokens = summarizeBatchesWithDstar(baseUrl, model, { tokenCounting: true }).batches?.countRawTokens
  summarize.cached = true
  if (options.selectBoundary) summarize.selectBoundary = (messages, boundary, archived, signal) =>
    options.selectBoundary!(owner, messages, boundary, archived, signal)
  return summarize
}


export async function strataHistoryHash(messages: UIMessage[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contextSourceFingerprint(messages)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Only attest the completed UI history to its current native owner. No chat
 * text is transmitted; a changed owner cannot acquire this old receipt. */
export async function bindStrataHistory(baseUrl: string, owner: string, history: UIMessage[]): Promise<void> {
  const historyHash = await strataHistoryHash(history)
  const response = await fetchDstarContext(`${baseUrl.replace(/\/$/, '')}/atomic/cache-receipt`, {
    method: 'POST', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, history_hash: historyHash }),
  })
  if (!response.ok) throw new Error(`Cache history receipt was not saved (${response.status})`)
}

/** Resume only an idle, restored cache bound to this exact completed turn.
 * A legacy checkpoint without a receipt remains usable for ordinary inference.
 * Await the handoff before sending the pending user turn, which would replace
 * the restored main owner. Native FORK revalidates committed IDs and count.
 */
export async function resumeRestoredStrataSummary(baseUrl: string, model: string,
  threadId: string, history: UIMessage[], projected: UIMessage[], context: number,
  coordinator: ContextCompaction, signal: AbortSignal,
  options: Parameters<typeof summarizeWithStrataCache>[3], promptTokens = 0): Promise<boolean> {
  if (history.at(-1)?.role !== 'user' || context <= 0 ||
      projected.some(message => message.parts.some(part => part.type === 'file'))) return false
  const completed = history.slice(0, -1)
  if (completed.at(-1)?.role !== 'assistant') return false
  const user = completed.findLast(message => message.role === 'user')
  if (!user) return false
  const owner = `${threadId}/${user.id}`
  let status
  try {
    const response = await fetchDstarContext(`${baseUrl.replace(/\/$/, '')}/status`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    })
    if (!response.ok) return false
    status = await response.json()
  } catch {
    signal.throwIfAborted()
    return false
  }
  const lane = status?.atomic_summary
  if (!status?.loaded || lane?.restored_cache_owner !== owner ||
      lane.active || lane.pending || lane.foreground_requests ||
      lane.rollback_pending || lane.recovery_required) return false
  if (typeof lane.restored_cache_hash !== 'string' ||
      lane.restored_cache_hash !== await strataHistoryHash(completed)) return false
  const summarize = summarizeWithStrataCache(baseUrl, model, owner, options)
  const raw = coordinator.previewReady(history).filter(message => !message.id.startsWith('atomic-context-'))
  const tokens = await summarize.countRawTokens!(raw, signal)
  if (tokens <= context * 0.6 && promptTokens < context * 0.85) return false
  await coordinator.recover(history, context, summarize, signal)
  return true
}
