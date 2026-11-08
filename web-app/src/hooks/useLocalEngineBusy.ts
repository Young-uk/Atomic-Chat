import { useAgentRun } from '@/hooks/useAgentRun'
import { isSessionBusy, useChatSessions } from '@/stores/chat-session-store'

const agentBusy = (status: string) => ['running', 'awaiting_approval', 'awaiting_folder_access'].includes(status)

/** A native agent's approval wait holds its engine just like a chat tool call. */
export function isLocalEngineBusy(exceptChatId?: string): boolean {
  const chats = useChatSessions.getState()
  return Object.entries(chats.requestActive).some(([id, active]) => id !== exceptChatId && active) ||
    Object.entries(chats.sessions).some(([id, session]) => id !== exceptChatId && isSessionBusy(session)) ||
    Object.entries(useAgentRun.getState().runs).some(([id, run]) => id !== exceptChatId && agentBusy(run.status))
}

export function useLocalEngineBusy(): boolean {
  const chatBusy = useChatSessions(state => Object.values(state.requestActive).some(Boolean) || Object.values(state.sessions).some(isSessionBusy))
  const nativeBusy = useAgentRun(state => Object.values(state.runs).some(run => agentBusy(run.status)))
  return chatBusy || nativeBusy
}
