import { render, screen, act, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ContextSummaryProgress } from './ContextSummaryProgress'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'
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
