import { act, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InferenceProgress } from '../InferenceProgress'
import { useInferenceProgress } from '@/lib/inference-progress'
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string, values?: { time?: string }) => key === 'inferenceProgress.elapsed' ? `Elapsed ${values?.time}` : key }) }))
beforeEach(() => {
  vi.useFakeTimers()
  useInferenceProgress.setState({ byThread: { a: { requestId: '1', startedAt: Date.now(), phase: 'reading', processed: 1, total: 4 } } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('shows actual progress without a disclosure, with elapsed time', () => {
  render(<InferenceProgress threadId="a" />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  act(() => vi.advanceTimersByTime(32000))
  expect(screen.getByText('Elapsed 0:32')).toBeInTheDocument()
})
it('does not fabricate percentages for reasoning or another thread', () => {
  act(() => useInferenceProgress.setState({ byThread: { a: { requestId: '2', startedAt: Date.now(), phase: 'thinking' } } }))
  const { rerender } = render(<InferenceProgress threadId="a" />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText('inferenceProgress.thinking')).toBeInTheDocument()
  rerender(<InferenceProgress threadId="b" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it.each(['thinking', 'generating', 'reading'] as const)('keeps the composer as the single %s progress owner', (phase) => {
  act(() => useInferenceProgress.setState({ byThread: { a: { requestId: '2', startedAt: Date.now(), phase, processed: 1, total: 4 } } }))
  render(<InferenceProgress threadId="a" />)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  if (phase === 'reading') expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  else expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
