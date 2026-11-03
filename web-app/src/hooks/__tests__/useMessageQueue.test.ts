import { beforeEach, expect, it } from 'vitest'
import { useMessageQueue } from '../useMessageQueue'
beforeEach(() => useMessageQueue.setState({ byThread: {}, paused: {}, inFlight: {} }))
it('claims in FIFO order once per thread and isolates other chats', () => {
  const queue = useMessageQueue.getState()
  queue.enqueue('a', { text: 'first', files: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AA', name: 'image' }] })
  queue.enqueue('a', { text: 'second' })
  queue.enqueue('b', { text: 'other' })
  expect(queue.claim('a')?.files?.[0].name).toBe('image')
  expect(queue.claim('a')).toBeUndefined()
  expect(queue.claim('b')?.text).toBe('other')
  queue.release('a')
  expect(queue.claim('a')?.text).toBe('second')
})
it('pauses, edits, reorders, prioritizes and deletes without losing attachments', () => {
  const queue = useMessageQueue.getState()
  queue.enqueue('a', { text: 'first' })
  queue.enqueue('a', { text: 'second' })
  const [first, second] = useMessageQueue.getState().byThread.a
  queue.pause('a', true)
  expect(queue.claim('a')).toBeUndefined()
  queue.update('a', second.id, 'edited')
  queue.move('a', second.id, -1)
  expect(useMessageQueue.getState().byThread.a[0].text).toBe('edited')
  queue.prioritize('a', first.id)
  queue.remove('a', second.id)
  queue.pause('a', false)
  expect(queue.claim('a')?.id).toBe(first.id)
})
it('holds a blank edited message instead of silently discarding it', () => {
  const queue = useMessageQueue.getState()
  queue.enqueue('a', { text: '' })
  expect(queue.claim('a')).toBeUndefined()
  expect(useMessageQueue.getState().byThread.a).toHaveLength(1)
})
it('steering waits for cancellation before allowing the selected message to dispatch', async () => {
  const { steerQueuedMessage } = await import('../useMessageQueue')
  const queue = useMessageQueue.getState()
  queue.enqueue('a', { text: 'older' })
  queue.enqueue('a', { text: 'urgent' })
  const urgent = useMessageQueue.getState().byThread.a[1]
  let finish!: () => void
  const stopped = new Promise<void>(resolve => { finish = resolve })
  const steering = steerQueuedMessage('a', urgent.id, () => stopped)
  expect(queue.claim('a')).toBeUndefined()
  finish()
  await steering
  expect(queue.claim('a')?.text).toBe('urgent')
})
it('invalidates pending preparation only for the interrupted thread', () => {
  const queue = useMessageQueue.getState()
  const before = useMessageQueue.getState().epoch.a ?? 0
  queue.invalidate('a')
  expect(useMessageQueue.getState().epoch.a).toBe(before + 1)
  expect(useMessageQueue.getState().epoch.b).toBeUndefined()
})
