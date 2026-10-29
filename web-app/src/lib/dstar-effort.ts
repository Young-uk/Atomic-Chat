import type { UIMessage } from 'ai'
import { isDstarEndpoint } from '@/services/dstar'

export type DstarEffort = 'off' | 'low' | 'medium' | 'high' | 'max'
export const DSTAR_EFFORT_METADATA = 'atomic_dstar_effort_v1'
const levels: readonly string[] = ['off', 'low', 'medium', 'high', 'max']

export function isDstarEffort(value: unknown): value is DstarEffort {
  return typeof value === 'string' && levels.includes(value)
}

/** Explicit experimental opt-in; never send the protocol to other servers. */
export function usesAppendOnlyDstarEffort(url?: string, modelId?: string): boolean {
  return import.meta.env.VITE_DSTAR_APPEND_EFFORT === 'true' &&
    isDstarEndpoint(url) && /^qwen3[._]8/i.test(modelId ?? '')
}

/** The snapshot is persisted with a user turn, not in its visible text. */
export function dstarEffortMetadata(
  enabled: boolean, disabled: boolean, budget: unknown
): Record<string, unknown> {
  if (!enabled) return {}
  const effort = disabled || budget === 'off' ? 'off' : budget
  return isDstarEffort(effort) ? { [DSTAR_EFFORT_METADATA]: effort } : {}
}

/** Expand immutable turn snapshots only in the model-bound copy. Keeping old
 * events in place is essential: moving/replacing them rewrites the KV prefix.
 * Legacy turns stay untouched; the first recorded turn starts the new policy.
 * Edited/regenerated turns replay their stored policy, just like their text. */
export function withDstarEffortUpdates(messages: UIMessage[]): UIMessage[] {
  let previous: DstarEffort | undefined
  const result: UIMessage[] = []
  for (const message of messages) {
    const metadata = message.metadata as Record<string, unknown> | undefined
    const effort = metadata?.[DSTAR_EFFORT_METADATA]
    if (message.role === 'user' && isDstarEffort(effort) && effort !== previous) {
      result.push({
        id: `atomic-effort-${message.id}`,
        role: 'system',
        parts: [{ type: 'text', text: `atomic-effort:v1:${effort}` }],
      })
      previous = effort
    }
    result.push(message)
  }
  return result
}
