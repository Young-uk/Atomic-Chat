import { create } from 'zustand'

export type InferenceProgress = {
  requestId: string
  startedAt: number
  phase: 'waiting' | 'reading' | 'preparing' | 'thinking' | 'generating' | 'checking'
  processed?: number
  total?: number
  cache?: number
  usageScope?: string
  runtimeScope?: string
}

export type ContextUsage = { tokens: number; estimated: boolean; modelId?: string; outputTokens?: number; usageScope?: string; runtimeScope?: string }
type ProgressState = { byThread: Record<string, InferenceProgress>; contextByThread?: Record<string, ContextUsage> }
/** Keep the most recent foreground measurement after its progress row ends.
 * Background summaries publish estimates separately, never their slot usage. */
export function publishContextUsage(threadId: string, usage: ContextUsage) {
  if (!Number.isFinite(usage.tokens) || usage.tokens < 0) return
  useInferenceProgress.setState(state => ({ contextByThread: {
    ...state.contextByThread, [threadId]: usage,
  } }))
}
export const useInferenceProgress = create<ProgressState>(() => ({ byThread: {} }))

/** Observe a copy of SSE bytes; never consume, delay, or rewrite the SDK stream. */
export function observeInferenceProgress(threadId: string, modelId?: string, usageScope?: string, runtimeScope?: string) {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  const update = (patch: Partial<InferenceProgress>) => {
    useInferenceProgress.setState(({ byThread }) => {
      const current = byThread[threadId]
      if (!current || current.requestId !== requestId) return { byThread }
      return { byThread: { ...byThread, [threadId]: {
        ...current, ...patch,
      } } }
    })
  }
  useInferenceProgress.setState(({ byThread }) => ({ byThread: {
    ...byThread, [threadId]: { requestId, startedAt, phase: 'waiting', usageScope, runtimeScope },
  } }))
  let pending = ''
  let ended = false
  return {
    push(data: string) {
      if (ended) return
      pending += data
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trimEnd()
        pending = pending.slice(newline + 1)
        try {
          if (line.startsWith(': atomic-progress ')) {
            const value = JSON.parse(line.slice(': atomic-progress '.length))
            const { processed, total, cache } = value
            if (![processed, total, cache].every(Number.isSafeInteger) ||
                total <= 0 || processed < 0 || processed > total || cache < 0) continue
            update({ phase: processed === total ? 'preparing' : 'reading', processed, total, cache })
            // Progress counts the unread suffix; add the cached prefix for context usage.
            if (useInferenceProgress.getState().byThread[threadId]?.requestId === requestId)
              publishContextUsage(threadId, { tokens: total + cache, estimated: false, modelId, usageScope, runtimeScope })
          } else if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            const value = JSON.parse(line.slice(6))
            // Strata/llama.cpp counts the cached prefix in processed/total;
            // Dstar's atomic comment already counts only the unread suffix.
            const pp = value.prompt_progress
            if (pp && [pp.processed, pp.total, pp.cache].every(Number.isSafeInteger) &&
                pp.cache >= 0 && pp.processed >= pp.cache && pp.total > 0 && pp.processed <= pp.total) {
              const processed = pp.processed - pp.cache
              const total = pp.total - pp.cache
              update({ phase: processed === total ? 'preparing' : 'reading', processed, total, cache: pp.cache })
              if (useInferenceProgress.getState().byThread[threadId]?.requestId === requestId)
                publishContextUsage(threadId, { tokens: pp.total, estimated: false, modelId, usageScope, runtimeScope })
            }
            const delta = value.choices?.[0]?.delta
            if (delta?.content || delta?.tool_calls?.length) update({ phase: 'generating' })
            else if (delta?.reasoning_content || delta?.reasoning) update({ phase: 'thinking' })
          }
        } catch { /* Unknown/malformed events must not interrupt inference. */ }
      }
      // A large generated JSON line is irrelevant to progress; bound observer memory.
      if (pending.length > 131072) pending = ''
    },
    finish() {
      ended = true
      useInferenceProgress.setState(({ byThread }) => {
        if (byThread[threadId]?.requestId !== requestId) return { byThread }
        const rest = { ...byThread }
        delete rest[threadId]
        return { byThread: rest }
      })
    },
  }
}

/** A bounded completion review uses the background slot but belongs to the
 * active visible turn. Clear only its own row, never a newer request's status. */
export function beginCompletionReviewProgress(threadId: string): () => void {
  const requestId = crypto.randomUUID()
  useInferenceProgress.setState(({ byThread }) => ({ byThread: { ...byThread,
    [threadId]: { requestId, startedAt: Date.now(), phase: 'checking' },
  } }))
  return () => useInferenceProgress.setState(({ byThread }) => {
    if (byThread[threadId]?.requestId !== requestId) return { byThread }
    const rest = { ...byThread }; delete rest[threadId]
    return { byThread: rest }
  })
}
