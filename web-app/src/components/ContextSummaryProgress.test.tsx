import { render, screen, act, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextSummaryProgress } from './ContextSummaryProgress'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'
import { beginDstarForeground, runIdleSummaryRequest } from '@/lib/dstar-summary-idle'
import { withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); vi.useRealTimers(); useContextSummaryProgress.setState({ byThread: {} }) })
it('shows only the selected thread and exposes actual completed sections and archive status', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now() - 12000, completed: 3, archived: true } } })
  const { rerender } = render(withTranslations(<ContextSummaryProgress threadId="b" />))
  expect(screen.queryByRole('status')).toBeNull()
  rerender(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByRole('status')).toHaveTextContent('Summarizing earlier messages')
  expect(screen.getByText('3 sections processed')).toBeInTheDocument()
  expect(screen.getByText('Original messages saved in the conversation archive.')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).toBeNull()
})
it('keeps failure visible and hides ready after five seconds', () => {
  vi.useFakeTimers()
  const now = Date.now()
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'ready', startedAt: now - 10000, completed: 7, archived: true, finishedAt: now } } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByRole('status')).toHaveTextContent('Summary ready')
  act(() => { vi.advanceTimersByTime(5000) })
  expect(screen.queryByRole('status')).toBeNull()
  act(() => { useContextSummaryProgress.setState({ byThread: { a: { phase: 'failed', startedAt: now, completed: 2, archived: true, finishedAt: now } } }) })
  act(() => { vi.advanceTimersByTime(10000) })
  expect(screen.getByRole('status')).toHaveTextContent('Original messages retained')
})
it('shows a paused summary without losing completed sections', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'paused', startedAt: Date.now() - 20000, completed: 3, archived: true } } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByRole('status')).toHaveTextContent('Summary paused · Chat has priority')
  expect(screen.getByText('3 sections processed')).toBeInTheDocument()
})

it('keeps an in-flight summary active during foreground scheduling, never paused or cancelled', async () => {
  const owner = new AbortController()
  const progress = { phase: 'summarizing' as const, startedAt: Date.now(), completed: 3, archived: true }
  useContextSummaryProgress.setState({ byThread: { a: progress } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  let finish!: () => void
  const phases: boolean[] = []
  const task = runIdleSummaryRequest('http://priority-progress', owner.signal, paused => {
    phases.push(paused)
  }, () => new Promise<void>(resolve => { finish = resolve }))
  const endForeground = beginDstarForeground('http://priority-progress')
  try {
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveTextContent('Summarizing earlier messages')
    expect(screen.getByText('3 sections processed')).toBeInTheDocument()
    expect(screen.queryByText(/paused|cancelled/i)).toBeNull()
    expect(phases).toEqual([false])
    expect(owner.signal.aborted).toBe(false)
    finish()
    await task
  } finally { endForeground() }
})

it('shows real input counts beside the summary while collapsed, without another thinking indicator', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now(), completed: 0, archived: true,
    input: { phase: 'reading', processed: 6144, total: 44877, cache: 13843 } } } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13.6')
  expect(screen.getByText(/6,144.*44,877/)).toBeInTheDocument()
  expect(screen.getByText(/13,843/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Summarizing earlier messages')
  expect(screen.queryByText(/Thinking/)).toBeNull()
})
it('labels resource preparation without inventing token counts or a percentage', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now(), completed: 0, archived: false,
    input: { phase: 'preparing' } } } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByText('Waiting to read input')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('separates generation from completed input without displaying output completion percentages', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now(), completed: 1, archived: true,
    input: { phase: 'generating', processed: 11219, total: 11219, request: 2 } } } })
  const { container } = render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByText('Input reading complete (11,219 new tokens)')).toBeInTheDocument()
  expect(screen.getByText('Generating summary')).toBeInTheDocument()
  expect(screen.getByText('Summary request 2')).toBeInTheDocument()
  expect(screen.getByText(/Total elapsed/)).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText(/100%|Generating response/)).toBeNull()
  expect([...container.querySelectorAll('span[aria-hidden="true"]')].filter(e => e.textContent === '·').length).toBeGreaterThanOrEqual(4)
})
it('distinguishes input completion before the first generated token', () => {
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now(), completed: 0, archived: true,
    input: { phase: 'reading', processed: 100, total: 100 } } } })
  render(withTranslations(<ContextSummaryProgress threadId="a" />))
  expect(screen.getByText('Preparing summary generation')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).toBeNull()
})
