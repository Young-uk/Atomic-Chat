import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InferenceProgress } from './InferenceProgress'
import { useInferenceProgress } from '@/lib/inference-progress'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('16px'); useInferenceProgress.setState({ byThread: {} }) })
it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('fits a narrow row at %s (dark: %s)', async (fontSize, dark) => {
  document.documentElement.classList.toggle('dark', dark)
  setFontSize(fontSize)
  useInferenceProgress.setState({ byThread: { a: { requestId: '1', startedAt: Date.now() - 3700000, phase: 'reading', processed: 999, total: 1000, cache: 64000 } } })
  render(withTranslations(<div style={{ width: 320 }} data-testid="column"><InferenceProgress threadId="a" /></div>))
  const column = screen.getByTestId('column')
  await settle(column)
  expectNoHorizontalOverflow(column)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99.9')
})


it.each([1024, 1280])('keeps input counts beside the status on one line at desktop width %s', async width => {
  setFontSize('20px')
  useInferenceProgress.setState({ byThread: { a: { requestId: 'inline', startedAt: Date.now() - 118000,
    phase: 'reading', processed: 13855, total: 63579, cache: 64000 } } })
  render(withTranslations(<div style={{ width: width - 304 }} data-testid="column"><InferenceProgress threadId="a" /></div>))
  const column = screen.getByTestId('column')
  await settle(column)
  const status = screen.getByText('Reading input'), counts = screen.getByText(/New input:/)
  expect(Math.abs(status.getBoundingClientRect().top - counts.getBoundingClientRect().top)).toBeLessThan(1)
  expect(getComputedStyle(counts).whiteSpace).toBe('nowrap')
  expect(counts).toHaveAttribute('title', expect.stringContaining('13,855 / 63,579'))
  expectNoHorizontalOverflow(column)
})
