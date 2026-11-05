import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, expect, it, vi } from 'vitest'
import { MessageQueue } from './MessageQueue'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { expectNoHorizontalOverflow, setFontSize, settle, XL_FONT_SIZE, DEFAULT_FONT_SIZE, setTheme } from '@/test/layout'
afterEach(cleanup)
it.each([1024, 1280])('queue controls fit at %i with large text', async width => {
  await page.viewport(width, 800)
  for (const size of ['16px', XL_FONT_SIZE]) {
    setFontSize(size)
    useMessageQueue.setState({ byThread: {}, paused: {}, inFlight: {} })
    useMessageQueue.getState().enqueue('layout', { text: 'A long queued message '.repeat(20) })
    const view = render(<div style={{ width: '50vw' }}><MessageQueue threadId="layout" onSendNow={() => {}} /></div>)
    await settle()
    expectNoHorizontalOverflow(screen.getByRole('region', { name: 'Message queue' }))
    expect(screen.getByRole('button', { name: 'Send now' }).getBoundingClientRect().width).toBeGreaterThan(0)
    view.unmount()
  }
})

for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [640, 896]) {
      it(`bounds queued messages at ${font} ${theme} ${width}`, async () => {
        setFontSize(font)
        setTheme(theme)
        useMessageQueue.getState().enqueue('a', { text: 'Long queued message '.repeat(40) })
        useMessageQueue.getState().enqueue('a', { text: 'Second message' })
        render(<div style={{ width }}><MessageQueue threadId="a" onSendNow={vi.fn()} /></div>)
        await settle()
        const queue = screen.getByRole('region', { name: 'Message queue' })
        expectNoHorizontalOverflow(queue)
        expect(queue.getBoundingClientRect().height).toBeLessThanOrEqual(176)
        fireEvent.click(screen.getByLabelText('Edit queued message 1'))
        await settle()
        expectNoHorizontalOverflow(queue)
        expect(queue.getBoundingClientRect().height).toBeLessThanOrEqual(176)
      })
    }
  }
}
