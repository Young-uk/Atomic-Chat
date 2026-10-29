import type { UIMessage } from 'ai'

export const DSTAR_TOOLS_METADATA = 'atomic_dstar_tools_v1'
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
  return messages.flatMap((message) => {
    const snapshot = (message.metadata as Record<string, unknown> | undefined)?.[DSTAR_TOOLS_METADATA]
    if (message.role !== 'user' || !isToolSnapshot(snapshot) || snapshot === previous) return [message]
    previous = snapshot
    return [{ id: `atomic-tools-${message.id}`, role: 'system' as const,
      parts: [{ type: 'text' as const, text: marker + snapshot }] }, message]
  })
}

/** Reconcile the SDK's original user objects with persisted hidden snapshots. */
export function replayDstarToolSnapshots(
  messages: UIMessage[],
  recorded: readonly { id: string; metadata?: Record<string, unknown> }[]
): UIMessage[] {
  const snapshots = new Map(recorded.map((message) => [message.id, message.metadata?.[DSTAR_TOOLS_METADATA]]))
  return messages.map((message) => {
    const tools = snapshots.get(message.id)
    return isToolSnapshot(tools)
      ? { ...message, metadata: { ...(message.metadata as Record<string, unknown>), [DSTAR_TOOLS_METADATA]: tools } }
      : message
  })
}
