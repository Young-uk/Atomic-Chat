import { useState } from 'react'
import { useMessageQueue, emptyMessageQueue } from '@/hooks/useMessageQueue'
import { Button } from '@/components/ui/button'

export function MessageQueue({ threadId, onSendNow }: { threadId: string; onSendNow: (id: string) => void }) {
  const items = useMessageQueue(state => state.byThread[threadId] ?? emptyMessageQueue)
  const paused = useMessageQueue(state => state.paused[threadId])
  const [editingId, setEditingId] = useState<string | null>(null)
  const queue = useMessageQueue.getState()
  if (!items.length) return null
  return <section aria-label="Message queue" className="mb-2 max-h-40 overflow-y-auto rounded-xl border px-2 py-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span>{paused ? 'Queue paused' : 'Queued messages'} · {items.length}</span>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => queue.pause(threadId, !paused)}>{paused ? 'Resume queue' : 'Pause queue'}</Button>
    </div>
    {items.map((item, index) => <div key={item.id} className="border-t py-1">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" aria-label={`Edit queued message ${index + 1}`} aria-expanded={editingId === item.id} title={item.text} onClick={() => setEditingId(editingId === item.id ? null : item.id)} className="min-w-0 flex-1 truncate text-left text-sm focus-visible:outline focus-visible:outline-ring">
          {item.text || 'Empty message'}{!!(item.files?.length || item.documents?.length) && ' · Attachments'}
        </button>
        <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" disabled={!item.text.trim()} onClick={() => onSendNow(item.id)}>Send now</Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label={`Move message ${index + 1} up`} disabled={index === 0} onClick={() => queue.move(threadId, item.id, -1)}>↑</Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label={`Move message ${index + 1} down`} disabled={index === items.length - 1} onClick={() => queue.move(threadId, item.id, 1)}>↓</Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label={`Remove queued message ${index + 1}`} onClick={() => queue.remove(threadId, item.id)}>×</Button>
      </div>
      {editingId === item.id && <textarea autoFocus aria-label={`Queued message ${index + 1}`} rows={2} value={item.text} onChange={event => queue.update(threadId, item.id, event.target.value)} className="mt-1 max-h-24 w-full resize-y rounded border bg-transparent p-1 text-sm" />}
    </div>)}
  </section>
}
