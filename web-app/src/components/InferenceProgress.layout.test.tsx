import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InferenceProgress } from './InferenceProgress'
import { useInferenceProgress } from '@/lib/inference-progress'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('16px'); useInferenceProgress.setState({ byThread: {} }) })
it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('fits a narrow row at %s (dark: %s)', async (fontSize, dark) => {
  document.documentElement.classList.toggle('dark', dark)
  setFontSize(fontSize)
  useInferenceProgress.setState({ byThread: { a: { requestId: '1', startedAt: Date.now() - 3700000, phase: 'reading', processed: 999, total: 1000 } } })
  render(withTranslations(<div style={{ width: 320 }} data-testid="column"><InferenceProgress threadId="a" /></div>))
  const column = screen.getByTestId('column')
  await settle(column)
  expectNoHorizontalOverflow(column)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99')
})
