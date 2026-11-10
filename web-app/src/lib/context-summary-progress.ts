import { create } from 'zustand'

export type SummaryInputProgress = {
  request?: number
  phase: 'preparing' | 'reading' | 'generating' | 'waiting-memory' | 'saving-state' | 'restoring-state'
  processed?: number
  total?: number
  cache?: number
}
export type SummaryProgress = {
  method?: 'clone' | 'segments'
  fallbackReason?: 'images' | 'unsupported' | 'headroom' | 'output_limit'
  input?: SummaryInputProgress
  phase: 'queued' | 'paused' | 'summarizing' | 'saving' | 'ready' | 'failed'
  startedAt: number
  completed: number
  archived: boolean
  finishedAt?: number
}
export const useContextSummaryProgress = create<{ byThread: Record<string, SummaryProgress> }>(() => ({ byThread: {} }))
export function publishSummaryProgress(threadId: string, progress?: SummaryProgress) {
  useContextSummaryProgress.setState(({ byThread }) => {
    const next = { ...byThread }
    if (progress) next[threadId] = progress
    else delete next[threadId]
    return { byThread: next }
  })
}
