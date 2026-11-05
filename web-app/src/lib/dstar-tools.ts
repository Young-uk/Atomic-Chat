import type { UIMessage } from 'ai'

export const DSTAR_TOOLS_METADATA = 'atomic_dstar_tools_v1'
export const DSTAR_TOOL_PREAMBLE_METADATA = 'atomic_dstar_tool_preamble_v1'
const marker = 'atomic-tools:v1:'

/** Canonicalize keys, preserving array order inside schemas. A connector returning
 * the same schema with different object-key order must not invalidate history. */
export function stableToolJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item
  )
}

export function isToolSnapshot(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const tools = JSON.parse(value)
    return Array.isArray(tools) && tools.every((tool) =>
      tool?.type === 'function' && typeof tool.function?.name === 'string' &&
      tool.function.parameters && typeof tool.function.parameters === 'object'
    )
  } catch { return false }
}

/** Replay recorded definitions in place. Raw API tools remain the current
 * allowlist; these historical definitions never grant execution permission. */
export function withDstarToolUpdates(messages: UIMessage[], originalHistory: UIMessage[] = messages): UIMessage[] {
  let previous: string | undefined
  let preambleSent: true | 'v2' | 'v3' | 'v4' | undefined
  const result: UIMessage[] = []
  // Compaction removes old visible turns, not their immutable configuration
  // anchor. Replaying the first recorded catalog avoids promoting a newer
  // retained turn's schema into the fixed prefix after every summary. The
  // current API allowlist still controls which tools may actually execute.
  const anchor = originalHistory.find(message => message.role === 'user' &&
    isToolSnapshot((message.metadata as Record<string, unknown> | undefined)?.[DSTAR_TOOLS_METADATA]))
  if (anchor && !messages.some(message => message.id === anchor.id)) {
    const wire = withDstarToolUpdates([anchor])
    result.push(...wire.filter(message => message.id !== anchor.id))
    previous = (anchor.metadata as Record<string, unknown>)[DSTAR_TOOLS_METADATA] as string
    preambleSent = (anchor.metadata as Record<string, unknown>)[DSTAR_TOOL_PREAMBLE_METADATA] as typeof preambleSent
  }
  let firstUser = true
  const removedAnchor = anchor && !messages.some(message => message.id === anchor.id)
  for (const message of messages) {
    // Configuration changes belong after the first retained user when the
    // original anchor was compacted. Otherwise they join the leading system
    // run ahead of the immutable effort anchor and invalidate retained KV.
    const deferUpdates = message.role === 'user' && firstUser && removedAnchor
    if (deferUpdates) result.push(message)
    const metadata = message.metadata as Record<string, unknown> | undefined
    const snapshot = metadata?.[DSTAR_TOOLS_METADATA]
    if (message.role === 'user' && isToolSnapshot(snapshot)) {
      if (snapshot !== previous) {
        result.push({ id: `atomic-tools-${message.id}`, role: 'system',
          parts: [{ type: 'text', text: marker + snapshot }] })
        previous = snapshot
        preambleSent = undefined
      }
      // Versioned policy starts only at a newly recorded turn. Never rewrite
      // historical catalog instructions to add the new behavior retroactively.
      const policy = metadata?.[DSTAR_TOOL_PREAMBLE_METADATA]
      if ((policy === true || policy === 'v2' || policy === 'v3' || policy === 'v4') && policy !== preambleSent) {
        result.push({ id: `atomic-tool-preamble-${message.id}`, role: 'system',
          parts: [{ type: 'text', text: policy === true ? 'atomic-tool-preamble:v1' : `atomic-tool-preamble:${policy}` }] })
        preambleSent = policy
      }
    }
    if (!deferUpdates) result.push(message)
    if (message.role === 'user') firstUser = false
  }
  return result
}

/** Reconcile the SDK's original user objects with persisted hidden snapshots. */
export function replayDstarToolSnapshots(
  messages: UIMessage[],
  recorded: readonly { id: string; metadata?: Record<string, unknown> }[]
): UIMessage[] {
  const snapshots = new Map(recorded.map((message) => [message.id, message.metadata]))
  return messages.map((message) => {
    const metadata = snapshots.get(message.id)
    const tools = metadata?.[DSTAR_TOOLS_METADATA]
    return isToolSnapshot(tools)
      ? { ...message, metadata: { ...(message.metadata as Record<string, unknown>), [DSTAR_TOOLS_METADATA]: tools,
          ...((metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === true || metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === 'v2' || metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === 'v3' || metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === 'v4') ? { [DSTAR_TOOL_PREAMBLE_METADATA]: metadata[DSTAR_TOOL_PREAMBLE_METADATA] } : {}) } }
      : message
  })
}
