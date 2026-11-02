import { useEffect } from 'react'
import { create } from 'zustand'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useChatSessions } from '@/stores/chat-session-store'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'

export const usePersonalMemoryActivity = create<{ phase: string; error?: string }>(() => ({ phase: 'idle' }))
export function personalMemoryMustPause(): boolean {
  const chats = useChatSessions.getState()
  return Object.values(chats.requestActive).some(Boolean) || Object.values(chats.sessions).some(session => session.isStreaming || session.status === 'submitted' || session.status === 'streaming') ||
    Object.values(useContextSummaryProgress.getState().byThread).some(progress => ['queued', 'paused', 'summarizing', 'saving'].includes(progress.phase))
}

/** Background formation gets permission to run only while both ordinary chat
 * and context summarization are idle. Never await it on the foreground path. */
export function PersonalMemoryLifecycleProvider() {
  const service = useServiceHub()
  const active = useMCPServers(state => state.mcpServers['atomic-personal-tools']?.active)
  useEffect(() => {
    if (!active || import.meta.env.VITE_PERSONAL_BUILD !== 'true') return
    let disposed = false
    let sending = false
    let lastBusy: boolean | undefined
    const publish = async (force = false) => {
      const busy = personalMemoryMustPause()
      if (disposed || sending || (!force && busy === lastBusy)) return
      sending = true
      try {
        const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_memory_lifecycle', arguments: { action: 'activity', busy } })
        if (result.error || ('isError' in result && result.isError)) throw new Error('Personal memory worker unavailable')
        const value = JSON.parse(result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? '{}')
        lastBusy = busy
        if (!disposed) usePersonalMemoryActivity.setState({ phase: value.phase ?? 'idle', error: value.last?.state === 'failed' ? value.last.reason : undefined })
      } catch (error) {
        lastBusy = undefined
        if (!disposed) usePersonalMemoryActivity.setState({ phase: 'unavailable', error: String(error) })
      } finally {
        sending = false
        if (!disposed && lastBusy !== undefined && personalMemoryMustPause() !== lastBusy) void publish()
      }
    }
    const unsubscribeChats = useChatSessions.subscribe(() => void publish())
    const unsubscribeSummary = useContextSummaryProgress.subscribe(() => void publish())
    void publish(true)
    const timer = setInterval(() => void publish(true), 5000)
    return () => { disposed = true; clearInterval(timer); unsubscribeChats(); unsubscribeSummary() }
  }, [service, active])
  return null
}
