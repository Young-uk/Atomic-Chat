import { useMessageQueue, emptyMessageQueue } from '@/hooks/useMessageQueue'
import { Button } from '@/components/ui/button'

export function MessageQueue({ threadId, onSendNow }: { threadId: string; onSendNow: (id: string) => void }) {
  const items = useMessageQueue(state => state.byThread[threadId] ?? emptyMessageQueue)
  const paused = useMessageQueue(state => state.paused[threadId])
  const queue = useMessageQueue.getState()
  if (!items.length) return null
  return <section aria-label="Message queue" className="mb-2 max-h-64 overflow-y-auto rounded-xl border p-2 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{paused ? 'Queue paused' : 'Queued messages'} · {items.length}</span>
      <Button size="sm" variant="ghost" onClick={() => queue.pause(threadId, !paused)}>{paused ? 'Resume queue' : 'Pause queue'}</Button>
    </div>
    {items.map((item, index) => <div key={item.id} className="space-y-1 rounded-lg border p-2">
      <textarea aria-label={`Queued message ${index + 1}`} value={item.text} onChange={event => queue.update(threadId, item.id, event.target.value)} className="w-full resize-y bg-transparent text-sm min-h-10" />
      {!!(item.files?.length || item.documents?.length) && <p className="text-xs text-muted-foreground">Attachments retained</p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={!item.text.trim()} onClick={() => onSendNow(item.id)}>Send now</Button>
        <Button size="sm" variant="ghost" aria-label={`Move message ${index + 1} up`} disabled={index === 0} onClick={() => queue.move(threadId, item.id, -1)}>↑</Button>
        <Button size="sm" variant="ghost" aria-label={`Move message ${index + 1} down`} disabled={index === items.length - 1} onClick={() => queue.move(threadId, item.id, 1)}>↓</Button>
        <Button size="sm" variant="ghost" onClick={() => queue.remove(threadId, item.id)}>Remove</Button>
      </div>
    </div>)}
  </section>
}
