import { invoke } from '@tauri-apps/api/core'
import { MessageStatus, ContentType, ChatCompletionRole, type ThreadMessage } from '@janhq/core'
import { desktopNotificationsEnabled, requestNotificationPermission } from './notifications'

export type ScheduledDelivery = {
  taskId: string; id: string; threadId?: string; finishedAt: number; dueAt?: number
  result?: string; error?: string
}

/** A deterministic message identity makes a crash after saving but before
 * acknowledging the outbox safe to replay without another chat message. */
export function scheduledResultMessage(row: ScheduledDelivery): ThreadMessage {
  if (!row.threadId) throw new Error('Scheduled result has no originating conversation')
  const deliveredAt = Math.max(row.finishedAt, row.dueAt ?? row.finishedAt)
  return { id: `scheduled-${row.id}`, object: 'thread.message', thread_id: row.threadId,
    role: ChatCompletionRole.Assistant, status: MessageStatus.Ready,
    created_at: deliveredAt, completed_at: deliveredAt,
    content: [{ type: ContentType.Text, text: { value: row.result || row.error || 'Scheduled task returned no result', annotations: [] } }],
    metadata: { personal_task_id: row.taskId, personal_task_run_id: row.id, scheduled: true } }
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
