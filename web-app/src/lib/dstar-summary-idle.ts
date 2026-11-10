/** Share foreground priority across chats using the same local endpoint.
 * Counts and notifications stay on the JS event loop; no new locks. */
type Lane = { owner?: string; active: number; listeners: Set<() => void> }
const lanes = new Map<string, Lane>()
function lane(baseUrl: string): Lane {
  const key = baseUrl.replace(/\/$/, '')
  let value = lanes.get(key)
  if (!value) { value = { active: 0, listeners: new Set() }; lanes.set(key, value) }
  return value
}
/** Last successfully completed native owner, shared by chats at this endpoint. */
export function noteDstarCacheOwner(baseUrl: string, owner: string): void { lane(baseUrl).owner = owner }
export function latestDstarCacheOwner(baseUrl: string, fallback: string): string { return lane(baseUrl).owner ?? fallback }

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

/** Previously a new foreground turn aborted the uncommitted HTTP fragment
 * and retried it after chat. Completed merges survived, but active work was lost.
 * The dedicated server scheduler now yields GPU work without cancelling this
 * request. Only the owner's signal (edits, shutdown, explicit cancellation)
 * can cancel the summary; foreground activity never restarts a fragment. */
export async function runIdleSummaryRequest<T>(_baseUrl: string, signal: AbortSignal,
  paused: (value: boolean) => void, run: (signal: AbortSignal) => Promise<T>,
  options?: { idleOnly?: boolean; serverIdle?: () => Promise<boolean> }): Promise<T> {
  signal.throwIfAborted()
  if (options?.idleOnly) {
    const value = lane(_baseUrl)
    // Recheck local activity after the server observation yields to the UI.
    while (value.active > 0 || (options.serverIdle && !(await options.serverIdle())) || value.active > 0) {
      paused(true)
      await new Promise<void>((resolve, reject) => {
        const clean = () => { clearTimeout(timer); value.listeners.delete(changed); signal.removeEventListener('abort', abort) }
        const changed = () => { clean(); resolve() }
        const abort = () => { clean(); reject(signal.reason) }
        const timer = setTimeout(changed, 500)
        value.listeners.add(changed); signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
      signal.throwIfAborted()
    }
  }
  signal.throwIfAborted()
  paused(false)
  return run(signal)
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
