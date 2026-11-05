import { create } from 'zustand'
import type { InitialMessagePayload } from './useInitialMessage'

export type QueuedMessage = InitialMessagePayload & { id: string }
type QueueState = {
  byThread: Record<string, QueuedMessage[]>
  paused: Record<string, boolean>
  inFlight: Record<string, boolean>
  epoch: Record<string, number>
  invalidate: (threadId: string) => void
  enqueue: (threadId: string, message: InitialMessagePayload) => void
  update: (threadId: string, id: string, text: string) => void
  remove: (threadId: string, id: string) => void
  move: (threadId: string, id: string, direction: -1 | 1) => void
  prioritize: (threadId: string, id: string) => void
  pause: (threadId: string, paused: boolean) => void
  pauseAfterError: (threadId: string) => void
  markSuccess: (threadId: string) => void
  retryAt: Record<string, number | undefined>
  errorRetry: Record<string, number>
  claim: (threadId: string) => QueuedMessage | undefined
  release: (threadId: string) => void
}
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const retryDelays = [5, 10, 20, 32, 64]
const empty: QueuedMessage[] = []
export const emptyMessageQueue = empty
// Session memory only: queued attachments are not written into preferences.
// A synchronous per-thread claim prevents duplicate sends across renders.
export const useMessageQueue = create<QueueState>((set, get) => ({
  byThread: {}, paused: {}, inFlight: {}, epoch: {}, errorRetry: {}, retryAt: {},
  invalidate: threadId => set(state => ({ epoch: { ...state.epoch, [threadId]: (state.epoch[threadId] ?? 0) + 1 } })),
  enqueue: (threadId, message) => set(state => ({ byThread: { ...state.byThread, [threadId]: [...(state.byThread[threadId] ?? []), { ...message, id: crypto.randomUUID() }] } })),
  update: (threadId, id, text) => set(state => ({ byThread: { ...state.byThread, [threadId]: (state.byThread[threadId] ?? []).map(item => item.id === id ? { ...item, text } : item) } })),
  remove: (threadId, id) => set(state => ({ byThread: { ...state.byThread, [threadId]: (state.byThread[threadId] ?? []).filter(item => item.id !== id) } })),
  move: (threadId, id, direction) => set(state => {
    const items = [...(state.byThread[threadId] ?? [])]
    const index = items.findIndex(item => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= items.length) return state
    ;[items[index], items[target]] = [items[target], items[index]]
    return { byThread: { ...state.byThread, [threadId]: items } }
  }),
  prioritize: (threadId, id) => set(state => {
    const items = state.byThread[threadId] ?? []
    const item = items.find(item => item.id === id)
    return item ? { byThread: { ...state.byThread, [threadId]: [item, ...items.filter(item => item.id !== id)] } } : state
  }),
  pause: (threadId, paused) => {
    // Explicit user controls always cancel automatic recovery, including Stop.
    clearTimeout(retryTimers.get(threadId))
    retryTimers.delete(threadId)
    set(state => ({ paused: { ...state.paused, [threadId]: paused }, retryAt: { ...state.retryAt, [threadId]: undefined } }))
  },
  pauseAfterError: threadId => {
    const state = get()
    // Do not turn a manual pause into an automatic one, or restart its timer
    // when multiple error callbacks report the same failed request.
    if (state.paused[threadId]) return
    const attempt = state.errorRetry[threadId] ?? 0
    const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)] * 1000
    set({ retryAt: { ...state.retryAt, [threadId]: Date.now() + delay }, paused: { ...state.paused, [threadId]: true }, errorRetry: { ...state.errorRetry, [threadId]: attempt + 1 } })
    retryTimers.set(threadId, setTimeout(() => {
      retryTimers.delete(threadId)
      set(current => ({ paused: { ...current.paused, [threadId]: false }, retryAt: { ...current.retryAt, [threadId]: undefined } }))
    }, delay))
  },
  markSuccess: threadId => set(state => ({ errorRetry: { ...state.errorRetry, [threadId]: 0 } })),
  claim: threadId => {
    const state = get()
    const item = state.byThread[threadId]?.[0]
    if (!item || !item.text.trim() || state.paused[threadId] || state.inFlight[threadId]) return
    set({ byThread: { ...state.byThread, [threadId]: state.byThread[threadId].slice(1) }, inFlight: { ...state.inFlight, [threadId]: true } })
    return item
  },
  release: threadId => set(state => ({ inFlight: { ...state.inFlight, [threadId]: false } })),
}))

// Keep dispatch paused until cancellation acknowledges completion. The route
// additionally gates dispatch on live SDK/agent idle status.
export async function steerQueuedMessage(threadId: string, id: string, stop: () => Promise<void>) {
  const queue = useMessageQueue.getState()
  queue.pause(threadId, true)
  queue.prioritize(threadId, id)
  await stop()
  queue.pause(threadId, false)
}
