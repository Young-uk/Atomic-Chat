import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMessages } from '@/hooks/useMessages'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'
import { captureBackgroundReviewEvidence } from '@/lib/background-review-evidence'
import { waitForThreadMessageWrites } from '@/lib/thread-message-sync'
import { bumpAgentSkillRevision } from '@/lib/agent-skill-revision'
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
  const { t } = useTranslation()
  const active = useMCPServers(state => state.mcpServers['atomic-personal-tools']?.active)
  useEffect(() => {
    if (!active || import.meta.env.VITE_PERSONAL_BUILD !== 'true') return
    let disposed = false
    let sending = false
    let lastBusy: boolean | undefined
    let observed = new Set<string>()
    let lastChangedReview: number | undefined
    const observeCompleted = async () => {
      if (personalMemoryMustPause()) return
      for (const [threadId, messages] of Object.entries(useMessages.getState().messages)) {
        if (threadId === 'temporary-chat') continue
        const answer = messages.at(-1)
        if (answer?.role !== 'assistant' || answer.metadata?.finishReason !== 'stop') continue
        const user = messages.findLast(row => row.role === 'user')
        const key = `${threadId}/${answer.id}`
        if (!user || observed.has(key)) continue
        await waitForThreadMessageWrites(threadId)
        if (disposed || personalMemoryMustPause()) return
        const view = convertThreadMessagesToUIMessages(messages)
        const text = (message: typeof view[number]) => message.parts.filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('\n')
        const userText = text(view.find(row => row.id === user.id)!), answerText = text(view.at(-1)!)
        if (!userText.trim() || !answerText.trim()) continue
        const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_memory_lifecycle', arguments: { action: 'observe', sessionId: threadId, messageId: answer.id, userMessage: userText, assistantReply: answerText, cacheOwner: `${threadId}/${user.id}`, turnCount: messages.filter(row => row.role === 'user').length, workCount: messages.flatMap(row => row.content).filter(part => part.type === 'tool_call').length, evidence: captureBackgroundReviewEvidence(view) } })
        if (result.error || ('isError' in result && result.isError)) throw new Error('Completed-turn review observation was refused')
        observed.add(key)
      }
    }
    const publish = async (force = false) => {
      const busy = personalMemoryMustPause()
      if (disposed || sending || (!force && busy === lastBusy)) return
      sending = true
      try {
        if (!busy) await observeCompleted()
        const result = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_memory_lifecycle', arguments: { action: 'activity', busy } })
        if (result.error || ('isError' in result && result.isError)) throw new Error('Personal memory worker unavailable')
        const value = JSON.parse(result.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? '{}')
        lastBusy = busy
        const changedReview = value.last?.reviewRunId
        if (value.last?.state === 'completed' && changedReview && changedReview !== lastChangedReview && value.last?.changes > 0) { bumpAgentSkillRevision(); lastChangedReview = changedReview; toast.success(t('tools:features.reviewCompleted'), { description: t('tools:features.reviewSavedChanges', { count: value.last.changes }), id: `background-review-${changedReview}` }) }
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
    const unsubscribeMessages = useMessages.subscribe(() => void publish(true))
    const unsubscribeSummary = useContextSummaryProgress.subscribe(() => void publish())
    void publish(true)
    const timer = setInterval(() => void publish(true), 5000)
    return () => { disposed = true; clearInterval(timer); unsubscribeChats(); unsubscribeSummary(); unsubscribeMessages(); observed = new Set() }
  }, [service, active, t])
  return null
}
