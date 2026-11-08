import { act, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InferenceProgress } from '../InferenceProgress'
import { useInferenceProgress } from '@/lib/inference-progress'
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  vi.useFakeTimers()
  useInferenceProgress.setState({ byThread: { a: { requestId: '1', startedAt: Date.now(), phase: 'reading', processed: 1, total: 4 } } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('shows actual progress without a disclosure, with elapsed time', () => {
  render(<InferenceProgress threadId="a" />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  act(() => vi.advanceTimersByTime(32000))
  expect(screen.getByText('0:32')).toBeInTheDocument()
})
it('does not fabricate percentages for reasoning or another thread', () => {
  act(() => useInferenceProgress.setState({ byThread: { a: { requestId: '2', startedAt: Date.now(), phase: 'thinking' } } }))
  const { rerender } = render(<InferenceProgress threadId="a" />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText('inferenceProgress.thinking')).toBeInTheDocument()
  rerender(<InferenceProgress threadId="b" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it.each(['thinking', 'generating'] as const)('leaves %s to the assistant indicator while preserving input progress', (phase) => {
  act(() => useInferenceProgress.setState({ byThread: { a: { requestId: '2', startedAt: Date.now(), phase } } }))
  const { rerender } = render(<InferenceProgress threadId="a" hasAssistantIndicator />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  rerender(<InferenceProgress threadId="a" />)
  expect(screen.getByRole('status')).toBeInTheDocument()
  act(() => useInferenceProgress.setState({ byThread: { a: { requestId: '3', startedAt: Date.now(), phase: 'reading', processed: 1, total: 4 } } }))
  rerender(<InferenceProgress threadId="a" hasAssistantIndicator />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
})
