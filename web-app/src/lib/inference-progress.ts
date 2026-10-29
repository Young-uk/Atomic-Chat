import { create } from 'zustand'

export type InferenceProgress = {
  requestId: string
  startedAt: number
  phase: 'waiting' | 'reading' | 'preparing' | 'thinking' | 'generating'
  processed?: number
  total?: number
  cache?: number
}

type ProgressState = { byThread: Record<string, InferenceProgress> }
export const useInferenceProgress = create<ProgressState>(() => ({ byThread: {} }))

/** Observe a copy of SSE bytes; never consume, delay, or rewrite the SDK stream. */
export function observeInferenceProgress(threadId: string) {
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
    ...byThread, [threadId]: { requestId, startedAt, phase: 'waiting' },
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
          } else if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            const value = JSON.parse(line.slice(6))
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
