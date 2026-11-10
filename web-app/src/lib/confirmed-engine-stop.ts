import { useChatSessions, isSessionBusy } from '@/stores/chat-session-store'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { cancelAgentTurn } from '@/services/agent/tauri'

/** User-confirmed shutdown also stops stuck frontend work and pauses queued sends. */
export function interruptWorkForEngineStop(): void {
  const chats = useChatSessions.getState()
  const ids = new Set([...Object.keys(chats.requestActive), ...Object.keys(chats.sessions)])
  for (const id of ids) {
    const session = chats.sessions[id]
    if (!chats.requestActive[id] && !isSessionBusy(session)) continue
    useMessageQueue.getState().invalidate(id)
    useMessageQueue.getState().pause(id, true)
    session?.data.toolAbort?.abort()
    if (session) {
      session.data.toolAbort = null
      session.data.tools = []
      void Promise.resolve(session.chat.stop()).catch(() => undefined)
      chats.updateStatus(id, 'ready')
    }
    chats.setRequestActive(id, false)
  }
  for (const [id, run] of Object.entries(useAgentRun.getState().runs)) {
    if (!run.runId || !['running', 'awaiting_approval', 'awaiting_folder_access'].includes(run.status)) continue
    useMessageQueue.getState().invalidate(id)
    useMessageQueue.getState().pause(id, true)
    void cancelAgentTurn(run.runId).catch(() => undefined)
  }
}
