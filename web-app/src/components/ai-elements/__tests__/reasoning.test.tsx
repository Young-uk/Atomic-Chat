import { act, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Reasoning, ReasoningContent, ReasoningTrigger } from '../reasoning'

const { markdownRenders } = vi.hoisted(() => ({ markdownRenders: vi.fn() }))

// Counting renders, not DOM: the finished trace used to be parsed for exactly
// one commit and unmounted by the auto-close effect on the next, which no
// assertion against the DOM can see.
vi.mock('streamdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('streamdown')>()
  const Streamdown = (props: ComponentProps<typeof actual.Streamdown>) => {
    markdownRenders(props.children)
    return <actual.Streamdown {...props} />
  }
  return { ...actual, Streamdown }
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('ReasoningContent', () => {
  it('uses the shared action-icon scale and a vertically centred trigger', () => {
    const { container, getByRole } = render(
      <Reasoning isStreaming defaultOpen>
        <ReasoningTrigger />
        <ReasoningContent isStreaming>Reasoning</ReasoningContent>
      </Reasoning>
    )

    const trigger = getByRole('button')
    const chevron = container.querySelector('.lucide-chevron-down')!
    expect(trigger).toHaveClass('min-h-6', 'items-center')
    expect(container.querySelector('.tabler-icon-bulb')).toHaveClass(
      'size-[18px]',
      'shrink-0'
    )
    expect(trigger.querySelector('.text-transparent')).toBeNull()
    expect(trigger).toHaveTextContent('Thinking for 1s…')
    expect(chevron.parentElement).toHaveClass(
      'inline-flex',
      'min-w-0',
      'items-center'
    )
    expect(chevron.previousElementSibling).toHaveClass('truncate')
    expect(chevron.previousElementSibling).not.toHaveClass('flex-1')
  })

  it('keeps one monotonic timer until the enclosing turn becomes terminal', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const { rerender, getByRole, queryByText } = render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>
    )

    expect(getByRole('button')).toHaveTextContent('Thinking for 1s…')
    act(() => vi.advanceTimersByTime(2_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 2s…')

    rerender(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(getByRole('button')).toHaveTextContent('Thinking for 2s…')

    rerender(
      <Reasoning defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>
    )
    expect(getByRole('button')).toHaveTextContent('Thought for 2s')
    expect(queryByText(/Thinking for/)).not.toBeInTheDocument()
    expect(queryByText('Thought for 2s')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(10_000))
    expect(getByRole('button')).toHaveTextContent('Thought for 2s')
  })

  it('excludes a suspended webview gap and resumes counting active time', () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { rerender, getByRole } = render(<Reasoning isStreaming><ReasoningTrigger /></Reasoning>)
    now = 2_000
    act(() => vi.advanceTimersByTime(1_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 2s')
    now += 6 * 60 * 60 * 1000
    act(() => vi.advanceTimersByTime(1_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 2s')
    now += 1_000
    act(() => vi.advanceTimersByTime(1_000))
    rerender(<Reasoning><ReasoningTrigger /></Reasoning>)
    expect(getByRole('button')).toHaveTextContent('Thought for 3s')
  })

  it('continues elapsed time when the wall clock moves backwards or forwards', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { getByRole } = render(
      <Reasoning isStreaming defaultOpen={false}>
        <ReasoningTrigger />
      </Reasoning>
    )
    act(() => vi.advanceTimersByTime(3_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 3s')
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    act(() => vi.advanceTimersByTime(2_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 5s')
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    act(() => vi.advanceTimersByTime(2_000))
    expect(getByRole('button')).toHaveTextContent('Thinking for 7s')
  })

  it('renders streaming reasoning as plain text, then Markdown once complete', async () => {
    const reasoning = '**Material finding**\n\n- first\n- second'
    const { container, rerender } = render(
      <Reasoning defaultOpen>
        <ReasoningContent isStreaming>{reasoning}</ReasoningContent>
      </Reasoning>
    )

    expect(container.querySelector('[data-streaming-reasoning]')).not.toBeNull()
    expect(container.querySelector('[data-streamdown="strong"]')).toBeNull()
    expect(container.querySelector('strong')).toHaveTextContent(
      'Material finding'
    )
    expect(container.textContent).not.toContain('**')

    rerender(
      <Reasoning defaultOpen>
        <ReasoningContent>{reasoning}</ReasoningContent>
      </Reasoning>
    )

    await waitFor(() =>
      expect(
        container.querySelector('[data-streamdown="strong"]')
      ).not.toBeNull()
    )
    expect(container.querySelector('[data-streaming-reasoning]')).toBeNull()
  })

  it('keeps the full long trace visible without invoking Markdown', () => {
    const longReasoning = '**token** '.repeat(12_000) + 'visible tail'
    const { container } = render(
      <Reasoning defaultOpen>
        <ReasoningContent isStreaming>{longReasoning}</ReasoningContent>
      </Reasoning>
    )

    expect(container.querySelector('[data-streaming-reasoning]')).not.toBeNull()
    expect(container.querySelector('[data-streamdown]')).toBeNull()
    expect(container.textContent).not.toContain(
      'earlier reasoning will appear when generation completes'
    )
    expect(container.textContent?.length).toBeGreaterThan(100_000)
    expect(container.textContent).toMatch(/visible tail$/)
  })

  it('keeps a just-finished live trace open and lightweight', () => {
    const reasoning = '**Material finding**\n\n- first\n- second'
    const { container, rerender } = render(
      <Reasoning isStreaming defaultOpen>
        <ReasoningTrigger />
        <ReasoningContent isStreaming>{reasoning}</ReasoningContent>
      </Reasoning>
    )

    expect(container.querySelector('[data-streaming-reasoning]')).not.toBeNull()
    markdownRenders.mockClear()

    rerender(
      <Reasoning defaultOpen>
        <ReasoningTrigger />
        <ReasoningContent>{reasoning}</ReasoningContent>
      </Reasoning>
    )

    expect(markdownRenders).not.toHaveBeenCalled()
    expect(container.querySelector('[data-streaming-reasoning]')).not.toBeNull()
    expect(getComputedStyle(container.firstElementChild!).display).not.toBe(
      'none'
    )
  })

  it('parses a stored trace when the reader opens its finished panel', async () => {
    const reasoning = '**Material finding**\n\n- first\n- second'
    const { container, getByRole } = render(
      <Reasoning defaultOpen={false}>
        <ReasoningTrigger />
        <ReasoningContent>{reasoning}</ReasoningContent>
      </Reasoning>
    )

    fireEvent.click(getByRole('button'))

    await waitFor(() =>
      expect(
        container.querySelector('[data-streamdown="strong"]')
      ).not.toBeNull()
    )
  })
})

describe('literal single tildes in reasoning', () => {
  it.each([false, true])('keeps the draw ranges literal while streaming=%s', async isStreaming => {
    const text = 'Each draw has 조 1~5, each with numbers 000000~999999. Total 1,000만 매 (판매점/인터넷 각각 500만매).'
    const { container } = render(<Reasoning isStreaming={isStreaming} defaultOpen>
      <ReasoningTrigger /><ReasoningContent isStreaming={isStreaming}>{text}</ReasoningContent>
    </Reasoning>)
    await waitFor(() => expect(container).toHaveTextContent(text))
    expect(container.querySelector('del')).toBeNull()
  })
  it('retains explicit double-tilde strikethrough and inline code', async () => {
    const { container } = render(<Reasoning defaultOpen>
      <ReasoningTrigger /><ReasoningContent>{'~말투~ · ~~취소~~ · `~code~`'}</ReasoningContent>
    </Reasoning>)
    await waitFor(() => expect(container.querySelector('del')).toHaveTextContent('취소'))
    expect(container.querySelectorAll('del')).toHaveLength(1)
    expect(container).toHaveTextContent('~말투~')
    expect(container.querySelector('code')).toHaveTextContent('~code~')
  })
})


it('keeps an automatic preview through answer generation and collapses at turn end', () => {
  const view = (thinking: boolean, active: boolean) => <Reasoning livePreview defaultOpen={false} isStreaming={thinking} isTurnActive={active}>
    <ReasoningTrigger /><ReasoningContent isStreaming={thinking}>Live thought.</ReasoningContent>
  </Reasoning>
  const {rerender,getByRole}=render(view(true,true))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','true')
  rerender(view(false,true))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','true')
  rerender(view(false,false))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','false')
  fireEvent.click(getByRole('button'))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','true')
})

it('keeps an explicit reader close or open when the turn completes', () => {
  const view = (active: boolean) => <Reasoning livePreview defaultOpen={false} isStreaming={active} isTurnActive={active}>
    <ReasoningTrigger /><ReasoningContent isStreaming={active}>Live thought.</ReasoningContent>
  </Reasoning>
  const {rerender,getByRole}=render(view(true))
  fireEvent.click(getByRole('button'))
  rerender(view(false))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','false')
  rerender(view(true))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','false')
  fireEvent.click(getByRole('button'))
  rerender(view(false))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','true')
})

it('keeps completed history collapsed until the reader opens it', () => {
  const {getByRole}=render(<Reasoning livePreview defaultOpen={false}><ReasoningTrigger /><ReasoningContent>Earlier thought.</ReasoningContent></Reasoning>)
  expect(getByRole('button')).toHaveAttribute('aria-expanded','false')
  fireEvent.click(getByRole('button'))
  expect(getByRole('button')).toHaveAttribute('aria-expanded','true')
})
