import { render, screen, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, expect, it } from 'vitest'
import { MessageQueue } from './MessageQueue'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { expectNoHorizontalOverflow, setFontSize, settle, XL_FONT_SIZE } from '@/test/layout'
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
