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
export function withDstarToolUpdates(messages: UIMessage[]): UIMessage[] {
  let previous: string | undefined
  let preambleSent: true | 'v2' | undefined
  const result: UIMessage[] = []
  for (const message of messages) {
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
      if ((policy === true || policy === 'v2') && policy !== preambleSent) {
        result.push({ id: `atomic-tool-preamble-${message.id}`, role: 'system',
          parts: [{ type: 'text', text: policy === 'v2' ? 'atomic-tool-preamble:v2' : 'atomic-tool-preamble:v1' }] })
        preambleSent = policy
      }
    }
    result.push(message)
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
          ...((metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === true || metadata?.[DSTAR_TOOL_PREAMBLE_METADATA] === 'v2') ? { [DSTAR_TOOL_PREAMBLE_METADATA]: metadata[DSTAR_TOOL_PREAMBLE_METADATA] } : {}) } }
      : message
  })
}
