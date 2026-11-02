import { useEffect } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useMessages } from '@/hooks/useMessages'
import { useChatSessions } from '@/stores/chat-session-store'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'
import { trackThreadMessageWrite } from '@/lib/thread-message-sync'
import { notifyScheduledResult, scheduledResultMessage, type ScheduledDelivery } from '@/lib/personal-task-delivery'

/** Outbox polling lives at app scope, independent of which chat/settings page
 * is mounted. It never sends a model request or silently retries inference. */
export function PersonalTaskDeliveryProvider() {
  const service = useServiceHub()
  const active = useMCPServers(state => state.mcpServers['atomic-personal-tools']?.active)
  useEffect(() => {
    if (!active || import.meta.env.VITE_PERSONAL_BUILD !== 'true') return
    let disposed = false
    let polling = false
    const retryAfter = new Map<string, number>()
    const call = async (arguments_: object) => {
      const response = await service.mcp().callTool({ serverName: 'atomic-personal-tools', toolName: 'personal_task_delivery', arguments: arguments_ })
      if (response.error || ('isError' in response && response.isError)) throw new Error('Scheduled delivery worker unavailable')
      return JSON.parse(response.content?.filter(part => 'text' in part).map(part => (part as { text: string }).text).join('\n') ?? 'null')
    }
    const poll = async () => {
      if (disposed || polling) return
      polling = true
      try {
        const rows: ScheduledDelivery[] = await call({ action: 'pending' })
        for (const row of rows) {
          if (disposed) break
          if ((retryAfter.get(row.id) ?? 0) > Date.now()) continue
          let messageId: string | undefined
          try {
            if (row.threadId) {
              const message = scheduledResultMessage(row)
              const saved = await service.messages().fetchMessages(row.threadId)
              if (!saved.some(existing => existing.id === message.id)) {
                await trackThreadMessageWrite(row.threadId, service.messages().createMessage(message))
                // Some legacy storage adapters return optimistically even
                // after a write error; read back before acknowledging delivery.
                const persisted = await service.messages().fetchMessages(row.threadId)
                if (!persisted.some(existing => existing.id === message.id)) throw new Error('Scheduled result could not be saved to its conversation')
              }
              useChatSessions.getState().upsertMessage(row.threadId, convertThreadMessagesToUIMessages([message])[0])
              const current = useMessages.getState().getMessages(row.threadId)
              if (!current.some(existing => existing.id === message.id)) {
                useMessages.getState().setMessages(row.threadId, [...current, message])
              }
              messageId = message.id
            }
            await notifyScheduledResult(row)
            await call({ action: 'record', taskId: row.taskId, runId: row.id, messageId })
          } catch (error) {
            retryAfter.set(row.id, Date.now() + 60000)
            await call({ action: 'record', taskId: row.taskId, runId: row.id, messageId, error: String(error).slice(0, 2000) })
          }
        }
      } catch (error) { console.warn('[personal-task-delivery]', error) }
      finally { polling = false }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => { disposed = true; clearInterval(timer) }
  }, [active, service])
  return null
}
