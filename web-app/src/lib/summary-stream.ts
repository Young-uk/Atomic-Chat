import type { SummaryInputProgress } from './context-summary-progress'

const admissionMessages = new Set([
  'Summary resources are ready, but memory pressure or swap activity is not stable; originals retained',
  'Not enough memory for the separate summary state; originals retained',
  'Summary is waiting for normal memory pressure, stable swap and available RAM; originals retained',
])
export const summaryAdmissionMessage = (message: unknown) => typeof message === 'string' && admissionMessages.has(message)
  ? message : 'Background summary deferred by server safety admission; originals retained'

/** Only this explicit capacity refusal may switch recovery strategies. */
export class SummaryHeadroomError extends Error {
  constructor() { super('Summary cache has insufficient context headroom; originals retained') }
}
export function checkSummaryHeadroom(error: { code?: unknown; message?: unknown } | undefined): void {
  // Dstar's existing isolated-slot guard predates structured capacity codes.
  if (error?.code === 'atomic_summary_headroom_exhausted' ||
      error?.message === 'cached summary exceeds snapshot or context headroom') throw new SummaryHeadroomError()
}

export class SummaryIdleError extends Error {
  constructor() { super('Recovery is waiting for the active conversation to finish; originals retained') }
}
export function checkSummaryIdle(error: { code?: unknown; message?: unknown } | undefined): void {
  if (error?.code === 'atomic_summary_admission_refused' &&
      error.message === 'Recovery is waiting for the active conversation to finish; originals retained') throw new SummaryIdleError()
}

/** Read only this summary's response; no shared engine polling or foreground usage updates. */
export async function readSummaryChoice(response: Response, signal: AbortSignal,
  progress?: (value?: SummaryInputProgress) => void) {
  if (!response.headers?.get('content-type')?.includes('text/event-stream'))
    return (await response.json()).choices?.[0]
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Summary response stream is missing; originals retained')
  const decoder = new TextDecoder()
  let buffer = '', frame: string[] = [], content = '', finish: string | null = null, done = false
  let input: SummaryInputProgress = { phase: 'preparing' }
  const report = (next: SummaryInputProgress) => { input = next; if (!signal.aborted) { try { progress?.(next) } catch { /* Display observers cannot invalidate a summary. */ } } }
  const counts = (processed: unknown, total: unknown, cache: unknown, inclusive: boolean) => {
    if (![processed, total, cache].every(Number.isSafeInteger)) return
    const p = processed as number, t = total as number, c = cache as number
    if (t <= 0 || c < 0 || p < (inclusive ? c : 0) || p > t || (inclusive && c > t)) return
    if (input.phase === 'generating') return
    report({ phase: 'reading', processed: p - (inclusive ? c : 0), total: t - (inclusive ? c : 0), cache: c })
  }
  const event = () => {
    if (!frame.length) return
    const raw = frame.join('\n'); frame = []
    if (raw === '[DONE]') { done = true; return }
    const value = JSON.parse(raw)
    if (value.error) {
      checkSummaryHeadroom(value.error)
      checkSummaryIdle(value.error)
      if (value.error.code === 'atomic_summary_admission_refused')
        throw new Error(summaryAdmissionMessage(value.error.message))
      throw new Error('Summary stream failed; originals retained')
    }
    const pp = value.prompt_progress
    if (pp) counts(pp.processed, pp.total, pp.cache, true)
    const choice = value.choices?.[0]
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      content += choice.delta.content
      if (content.length > 2_097_152) throw new Error('Summary stream exceeded its output bound; originals retained')
      report({ ...input, phase: 'generating', ...(input.total !== undefined ? { processed: input.total } : {}) })
    }
    if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason
  }
  const line = (raw: string) => {
    const text = raw.replace(/\r$/, '')
    if (!text) return event()
    if (text.startsWith(': atomic-progress ')) {
      try { const p = JSON.parse(text.slice(': atomic-progress '.length)); counts(p.processed, p.total, p.cache, false) }
      catch { /* Malformed progress must not affect a valid response. */ }
    } else if (text.startsWith('data:')) frame.push(text.slice(5).replace(/^ /, ''))
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const next = await reader.read()
      buffer += decoder.decode(next.value, { stream: !next.done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
      if (buffer.length > 1_048_576) throw new Error('Summary stream frame exceeded its bound; originals retained')
      if (next.done) break
    }
    if (buffer) line(buffer)
    event()
    signal.throwIfAborted()
    if (!done || !finish) throw new Error('Summary stream ended before completion; originals retained')
    return { message: { role: 'assistant', content }, finish_reason: finish }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
