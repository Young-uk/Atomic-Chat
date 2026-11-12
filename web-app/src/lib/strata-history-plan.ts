import { convertToOpenAICompatibleChatMessages } from '@ai-sdk/openai-compatible/internal'
import type { ModelMessage, UIMessage } from 'ai'
import { fetchDstarContext } from './dstar-context-archive'
import { logCompactionBudget } from './dstar-context-compaction'

/** Use the installed provider's actual wire serializer, including tool results
 * and reasoning. Planning tokenizes text only; it never calls model generation. */
export function historyPlanMessages(messages: ModelMessage[]): unknown[] {
  const prompt = messages.map(message => message.role === 'user' || message.role === 'assistant'
    ? { ...message, content: typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content }
    : message)
  return convertToOpenAICompatibleChatMessages(prompt as Parameters<typeof convertToOpenAICompatibleChatMessages>[0])
}

/** The nominal recent-history target is a minimum: consider only earlier whole
 * user turns, so alignment never discards additional recent dialogue. */
export async function planStrataHistoryBoundary(baseUrl: string, model: string, owner: string,
  history: UIMessage[], boundary: number, archived: number, signal: AbortSignal,
  wire: (retained: UIMessage[]) => unknown[], request: Record<string, unknown>, requireMatch = false): Promise<number> {
  const boundaries = [boundary, ...history.flatMap((message, index) =>
    index > archived && index < boundary && message.role === 'user' ? [index] : []).reverse()].slice(0, 16)
  try {
    const response = await fetchDstarContext(`${baseUrl.replace(/\/$/, '')}/atomic/history-plan`, {
      method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, model, owner,
        candidates: boundaries.map(value => ({ boundary: value, messages: wire(history.slice(value)) })) }),
    })
    if (!response.ok) {
      logCompactionBudget('cache alignment request refused', { status: response.status, boundary })
      return requireMatch ? -1 : boundary
    }
    const result = await response.json()
    if (result.reason === 'aligned' && boundaries.includes(result.boundary)) {
      logCompactionBudget('cache-aligned archive boundary', {
        requestedBoundary: boundary, selectedBoundary: result.boundary, reusedTokens: result.retained_tokens,
      })
      return result.boundary
    }
    logCompactionBudget('cache alignment unavailable', { reason: result.reason, boundary })
  } catch (error) {
    signal.throwIfAborted()
    // Never log request bodies or exception messages containing dialogue.
    logCompactionBudget('cache alignment request failed', {
      boundary, error: error instanceof Error ? error.name : 'UnknownError',
    })
  }
  return requireMatch ? -1 : boundary
}
