import type { UIMessage } from 'ai'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { STRATA_MODEL, STRATA_PROVIDER } from '@/services/managed-local-engine'
import { hasUnresolvedToolCallParts } from './execute-chat-tool-calls'

// A normal stop can occur mid-sentence or mid-table. Let the user decide.
export function canContinueStrataReply(
  last: UIMessage | undefined,
  provider: string | undefined,
  model: string | undefined,
): boolean {
  if (provider !== STRATA_PROVIDER || model !== STRATA_MODEL || last?.role !== 'assistant') return false
  const meta = last.metadata as Record<string, unknown> | undefined
  return meta?.providerId === provider && meta.modelId === model &&
    (meta.finishReason === 'stop' || meta.finishReason === 'length') &&
    !meta.turn_error && !hasUnresolvedToolCallParts(last) &&
    last.parts.some(part => part.type === 'text' && part.text.trim().length > 0)
}

export function enqueueReplyContinuation(threadId: string, text: string) {
  // Check at click time as a second click can arrive before React repaints.
  const queue = useMessageQueue.getState()
  if (queue.paused[threadId] || queue.inFlight[threadId] || queue.byThread[threadId]?.length) return
  // An explicit empty attachment snapshot preserves any unsent composer draft.
  queue.enqueue(threadId, { text, documents: [] })
}
