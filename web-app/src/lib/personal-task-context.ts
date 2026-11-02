import { useThreads } from '@/hooks/useThreads'
import { useAssistant } from '@/hooks/useAssistant'

/** Capture the same live assistant instructions as the normal chat route.
 * Model-authored task text cannot replace the originating thread or voice. */
export function personalTaskInput(toolName: string, threadId: string, input: object): object {
  if (toolName !== 'personal_tasks' || (input as { action?: string }).action !== 'create') return input
  const snapshot = useThreads.getState().threads[threadId]?.assistants?.[0]
  const live = useAssistant.getState().assistants.find(assistant => assistant.id === snapshot?.id)
  return { ...input, originThreadId: threadId,
    assistantInstructions: live?.instructions ?? snapshot?.instructions ?? '' }
}
