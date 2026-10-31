import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ContextSummaryProgress } from './ContextSummaryProgress'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('13px'); useContextSummaryProgress.setState({ byThread: {} }) })
it.each([['13px', false], ['20px', false], ['13px', true], ['20px', true]] as const)('fits long status at %s and dark=%s', async (font, dark) => {
  setFontSize(font); document.documentElement.classList.toggle('dark', dark)
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'failed', startedAt: Date.now() - 3700000, finishedAt: Date.now(), completed: 1234, archived: true } } })
  render(withTranslations(<div style={{ width: 280 }} data-testid="column"><ContextSummaryProgress threadId="a" /></div>))
  const column = screen.getByTestId('column')
  const details = column.querySelector('details')!
  details.open = true
  await settle(column)
  expectNoHorizontalOverflow(column)
  expect(screen.getByRole('status')).toBeVisible()
})
