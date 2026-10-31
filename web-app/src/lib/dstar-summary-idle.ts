/** Share foreground priority across chats using the same local endpoint.
 * Counts and notifications stay on the JS event loop; no new locks. */
type Lane = { active: number; listeners: Set<() => void> }
const lanes = new Map<string, Lane>()
function lane(baseUrl: string): Lane {
  const key = baseUrl.replace(/\/$/, '')
  let value = lanes.get(key)
  if (!value) { value = { active: 0, listeners: new Set() }; lanes.set(key, value) }
  return value
}
export function beginDstarForeground(baseUrl: string): () => void {
  const value = lane(baseUrl)
  value.active++
  for (const notify of [...value.listeners]) notify()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    value.active--
    for (const notify of [...value.listeners]) notify()
  }
}

/** A new foreground turn aborts only the uncommitted HTTP fragment. Retry the
 * same fragment after the foreground turn finishes; completed merges survive. */
export async function runIdleSummaryRequest<T>(baseUrl: string, signal: AbortSignal,
  paused: (value: boolean) => void, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const value = lane(baseUrl)
  for (;;) {
    signal.throwIfAborted()
    if (value.active) {
      paused(true)
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { value.listeners.delete(changed); signal.removeEventListener('abort', aborted) }
        const changed = () => { if (!value.active) { cleanup(); resolve() } }
        const aborted = () => { cleanup(); reject(signal.reason) }
        value.listeners.add(changed)
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
        else changed()
      })
    }
    signal.throwIfAborted()
    paused(false)
    const interrupted = new AbortController()
    const changed = () => { if (value.active) { paused(true); interrupted.abort() } }
    value.listeners.add(changed)
    try {
      const result = await run(AbortSignal.any([signal, interrupted.signal]))
      if (!interrupted.signal.aborted) return result
    } catch (error) {
      if (!interrupted.signal.aborted || signal.aborted) throw error
    } finally { value.listeners.delete(changed) }
  }
}

/** A provider's stop label alone is insufficient: client tools can still be
 * waiting for approval/results or awaiting a final answer after their outputs. */
export function summaryTurnHasToolsPending(message: import('ai').UIMessage | undefined): boolean {
  if (!message) return false
  let lastTool = -1
  for (const [index, part] of message.parts.entries()) {
    if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) continue
    lastTool = index
    if (!['output-available', 'output-error', 'output-denied'].includes((part as { state?: string }).state ?? '')) return true
  }
  return lastTool >= 0 && !message.parts.slice(lastTool + 1).some(p => p.type === 'text' && p.text.trim())
}
