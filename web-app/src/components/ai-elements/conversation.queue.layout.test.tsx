import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StickToBottomContext } from 'use-stick-to-bottom'
import { Conversation, ConversationContent } from './conversation'
import { MessageQueue } from '@/containers/MessageQueue'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, setFontSize, setTheme, settle, expectNoHorizontalOverflow } from '@/test/layout'

const thread = 'queue-geometry-test'
afterEach(() => { act(() => useMessageQueue.setState({ byThread: {}, paused: {}, inFlight: {} })) })

function fixture() {
  const context = createRef<StickToBottomContext>()
  render(<div data-testid="shell" className="flex flex-col overflow-hidden min-w-0" style={{ height: 620, width: 'min(100%, 1040px)' }}>
    <div data-testid="messages" className="flex-1 relative">
      <Conversation className="absolute inset-0" contextRef={context}>
        <ConversationContent>
          <div style={{ height: 1400 }}>Earlier conversation</div>
          <p data-testid="latest">Latest streaming answer remains visible above queued messages.</p>
        </ConversationContent>
      </Conversation>
    </div>
    <div data-testid="footer" className="py-4 mx-auto w-full md:w-4/5 xl:w-4/6">
      <MessageQueue threadId={thread} onSendNow={vi.fn()} />
      <div style={{ height: 120 }} className="border rounded-3xl">Composer</div>
    </div>
  </div>)
  return context
}

async function expectLatestVisible() {
  await waitFor(() => {
    const latest = screen.getByTestId('latest').getBoundingClientRect()
    const pane = screen.getByTestId('messages').getBoundingClientRect()
    const footer = screen.getByTestId('footer').getBoundingClientRect()
    expect(latest.bottom).toBeLessThanOrEqual(pane.bottom + 2)
    expect(pane.bottom).toBeLessThanOrEqual(footer.top + 1)
  })
}

describe('conversation viewport follows changing message queue height', () => {
  it.each([1024, 1280].flatMap(width => [DEFAULT_FONT_SIZE, XL_FONT_SIZE].flatMap(font => (['light', 'dark'] as const).map(theme => ({ width, font, theme })))))
  ('keeps the latest answer visible at $width / $font / $theme', async ({ width, font, theme }) => {
    await page.viewport(width, 800)
    setFontSize(font); setTheme(theme)
    const context = fixture()
    await act(async () => { await context.current!.scrollToBottom({ animation: 'instant' }) })
    await expectLatestVisible()
    act(() => useMessageQueue.getState().enqueue(thread, { text: '다음 질문도 계속 확인해 주세요 — long queued message with attachments and translated actions' }))
    await settle()
    await expectLatestVisible()
    act(() => fireEvent.click(screen.getByLabelText('Edit queued message 1')))
    await settle()
    await expectLatestVisible()
    act(() => { for (let i = 0; i < 7; i++) useMessageQueue.getState().enqueue(thread, { text: `Queued message ${i + 2}` }) })
    await settle()
    await expectLatestVisible()
    expectNoHorizontalOverflow(screen.getByTestId('shell'))
    act(() => useMessageQueue.setState({ byThread: {} }))
    await settle()
    await expectLatestVisible()
  })

  it('preserves the reading position when the user scrolled into history', async () => {
    await page.viewport(1280, 800); setFontSize(DEFAULT_FONT_SIZE); setTheme('dark')
    const context = fixture()
    await act(async () => { await context.current!.scrollToBottom({ animation: 'instant' }) })
    const scroll = context.current!.scrollRef.current!
    act(() => { context.current!.stopScroll(); scroll.scrollTop -= 350; fireEvent.scroll(scroll) })
    await settle()
    const before = scroll.scrollTop
    act(() => useMessageQueue.getState().enqueue(thread, { text: 'Do not steal my reading position' }))
    await settle()
    expect(Math.abs(scroll.scrollTop - before)).toBeLessThanOrEqual(1)
  })
})
