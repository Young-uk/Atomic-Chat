import { fireEvent, render, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HISTORY_OPEN_EVENT, openHistoryLink, parseHistoryLink, useChatHistoryNavigation } from '../chat-history-links'
import { scrollFindTarget } from '../find-highlight'

vi.mock('../find-highlight', () => ({ scrollFindTarget: vi.fn() }))

describe('conversation history sources', () => {
  it('accepts local message sources and rejects external navigation, injected parameters and invalid ids', () => {
    expect(parseHistoryLink('/threads/room-one?historyMessage=message-1')).toEqual({ threadId: 'room-one', messageId: 'message-1' })
    expect(parseHistoryLink('tauri://localhost/threads/room-one?historyMessage=message-1')).toEqual({ threadId: 'room-one', messageId: 'message-1' })
    for (const link of ['https://example.com/threads/room-one?historyMessage=m', '//example.com/threads/room-one?historyMessage=m', 'javascript:alert(1)', '/threads/room-one?historyMessage=m&threadModel=forged', '/threads/room-one?historyMessage=m&historyMessage=other', '/threads/room-one?historyMessage=%3Cscript%3E', 'tauri://user@localhost/threads/room-one?historyMessage=m']) expect(parseHistoryLink(link)).toBeUndefined()
  })
  it('captures a local source from a custom anchor exactly once', () => {
    const external = vi.fn()
    function Page() {
      const root = useRef<HTMLDivElement>(null)
      const [selected, setSelected] = useState<{ threadId: string; messageId: string } | null>(null)
      useChatHistoryNavigation(root, 'origin', undefined, [], setSelected)
      return <div ref={root}><a href="/threads/previous?historyMessage=outfit" onClick={external}>Source</a><output>{selected ? `${selected.threadId}/${selected.messageId}` : 'No source selected'}</output></div>
    }
    const { getByText } = render(<Page />)
    expect(getByText('No source selected')).toBeVisible()
    fireEvent.click(getByText('Source'))
    expect(getByText('previous/outfit')).toBeVisible()
    expect(external).not.toHaveBeenCalled()
  })
  it('dispatches navigation without submitting a request and waits for the target message to load', async () => {
    const onOpen = vi.fn()
    function Page({ loaded, appended = false }: { loaded: boolean; appended?: boolean }) {
      const root = useRef<HTMLDivElement>(null)
      const messages = loaded ? [{ id: 'target' }, ...(appended ? [{ id: 'later' }] : [])] : []
      useChatHistoryNavigation(root, 'room-one', 'target', messages, onOpen)
      return <div ref={root}>{loaded && <div data-atomic-find-message="target"><div data-atomic-find-rendered-text><p>Original source text</p></div></div>}</div>
    }
    const { rerender } = render(<Page loaded={false} />)
    expect(openHistoryLink('/threads/room-one?historyMessage=target')).toBe(true)
    expect(onOpen).toHaveBeenCalledWith({ threadId: 'room-one', messageId: 'target' })
    expect(scrollFindTarget).not.toHaveBeenCalled()
    rerender(<Page loaded />)
    await waitFor(() => expect(scrollFindTarget).toHaveBeenCalledTimes(1))
    expect((vi.mocked(scrollFindTarget).mock.calls[0][0] as Range).toString()).toBe('Original source text')
    rerender(<Page loaded appended />)
    expect(scrollFindTarget).toHaveBeenCalledTimes(1)
    onOpen.mockClear()
    window.dispatchEvent(new CustomEvent(HISTORY_OPEN_EVENT, { detail: '/threads/room-one?historyMessage=target&threadModel=forged' }))
    expect(onOpen).not.toHaveBeenCalled()
  })
})
