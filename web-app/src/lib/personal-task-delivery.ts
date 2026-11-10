import type { UIMessage } from 'ai'
import { invoke } from '@tauri-apps/api/core'
import { MessageStatus, ContentType, ChatCompletionRole, type ThreadMessage } from '@janhq/core'
import { desktopNotificationsEnabled, requestNotificationPermission } from './notifications'

export type ScheduledDelivery = {
  taskId: string; id: string; threadId?: string; finishedAt: number; dueAt?: number
  result?: string; error?: string
}

/** A deterministic message identity makes a crash after saving but before
 * acknowledging the outbox safe to replay without another chat message. */
export function scheduledResultMessage(row: ScheduledDelivery, afterUserId?: string): ThreadMessage {
  if (!row.threadId) throw new Error('Scheduled result has no originating conversation')
  const deliveredAt = Math.max(row.finishedAt, row.dueAt ?? row.finishedAt)
  return { id: `scheduled-${row.id}`, object: 'thread.message', thread_id: row.threadId,
    role: ChatCompletionRole.Assistant, status: MessageStatus.Ready,
    created_at: deliveredAt, completed_at: deliveredAt,
    content: [{ type: ContentType.Text, text: { value: row.result || row.error || 'Scheduled task returned no result', annotations: [] } }],
    metadata: { personal_task_id: row.taskId, personal_task_run_id: row.id, scheduled: true,
      ...(afterUserId ? { scheduled_after_user_id: afterUserId, scheduled_order: deliveredAt } : {}) } }
}

/** Await the real application notification command. Submission is a receipt
 * from the OS API, not proof that the user saw a banner (Focus can hide it). */
export async function notifyScheduledResult(row: ScheduledDelivery): Promise<void> {
  if (!desktopNotificationsEnabled()) throw new Error('Desktop notifications are disabled in app settings')
  if (!(await requestNotificationPermission())) throw new Error('Desktop notification permission is not granted')
  await invoke('show_desktop_notification', {
    title: row.error ? 'Scheduled task failed' : 'Reminder',
    body: (row.result || row.error || '').slice(0, 1000),
  })
}


/** Show reminders immediately, but never splice one into a model's unfinished
 * tool-bearing assistant turn. Fixed user anchors survive durable replay. */
export function scheduledMessagesForModel(messages: UIMessage[]): UIMessage[] {
  const latestUser = messages.findLast(message => message.role === 'user')?.id
  const users = new Set(messages.filter(message => message.role === 'user').map(message => message.id))
  const anchored = messages.flatMap(message => {
    const metadata = message.metadata as Record<string, unknown> | undefined
    const anchor = metadata?.scheduled_after_user_id
    return message.role === 'assistant' && metadata?.scheduled === true &&
      typeof anchor === 'string' && users.has(anchor) ? [{ message, anchor,
        order: typeof metadata.scheduled_order === 'number' ? metadata.scheduled_order : 0 }] : []
  })
  if (!anchored.length) return messages
  const ids = new Set(anchored.map(item => item.message.id))
  const base = messages.filter(message => !ids.has(message.id))
  const before = new Map<string, UIMessage[]>()
  for (const { message, anchor } of anchored.sort((a, b) => a.order - b.order || a.message.id.localeCompare(b.message.id))) {
    if (anchor === latestUser) continue
    const index = base.findIndex(item => item.id === anchor)
    const nextUser = base.slice(index + 1).find(item => item.role === 'user')
    if (!nextUser) continue
    const group = before.get(nextUser.id) ?? []
    group.push(message)
    before.set(nextUser.id, group)
  }
  return base.flatMap(message => [...(before.get(message.id) ?? []), message])
}
