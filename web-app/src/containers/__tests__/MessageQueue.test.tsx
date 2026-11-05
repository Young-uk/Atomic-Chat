import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MessageQueue } from '../MessageQueue'
import { useMessageQueue } from '@/hooks/useMessageQueue'
beforeEach(() => useMessageQueue.setState({ byThread: {}, paused: {}, inFlight: {} }))
it('lets users edit, prioritize, pause and remove queued messages', () => {
  const queue = useMessageQueue.getState()
  queue.enqueue('a', { text: 'first' })
  queue.enqueue('a', { text: 'second' })
  const sendNow = vi.fn()
  render(<MessageQueue threadId="a" onSendNow={sendNow} />)
  fireEvent.click(screen.getByLabelText('Edit queued message 2'))
  fireEvent.change(screen.getByLabelText('Queued message 2'), { target: { value: 'changed' } })
  expect(useMessageQueue.getState().byThread.a[1].text).toBe('changed')
  fireEvent.click(screen.getByLabelText('Move message 2 up'))
  expect(screen.getByLabelText('Queued message 1')).toHaveValue('changed')
  fireEvent.click(screen.getAllByRole('button', { name: 'Send now' })[0])
  expect(sendNow).toHaveBeenCalledWith(useMessageQueue.getState().byThread.a[0].id)
  fireEvent.click(screen.getByRole('button', { name: 'Pause queue' }))
  expect(queue.claim('a')).toBeUndefined()
  fireEvent.click(screen.getByLabelText('Remove queued message 1'))
  expect(useMessageQueue.getState().byThread.a.map(item => item.text)).toEqual(['first'])
})
