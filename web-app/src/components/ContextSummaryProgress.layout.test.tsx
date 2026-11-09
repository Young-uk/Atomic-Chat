import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ContextSummaryProgress } from './ContextSummaryProgress'
import { useContextSummaryProgress } from '@/lib/context-summary-progress'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('13px'); useContextSummaryProgress.setState({ byThread: {} }) })
it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('fits long status at %s and dark=%s', async (font, dark) => {
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

it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('keeps collapsed summary input visible at %s dark=%s', async (font, dark) => {
  setFontSize(font); document.documentElement.classList.toggle('dark', dark)
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now() - 3600000, completed: 1234, archived: true,
    input: { phase: 'reading', processed: 65535999, total: 65536000, cache: 123456789, request: 99999 } } } })
  render(withTranslations(<div style={{ width: 280 }} data-testid="input-column"><ContextSummaryProgress threadId="a" /></div>))
  const column = screen.getByTestId('input-column')
  await settle(column)
  expectNoHorizontalOverflow(column)
  expect(screen.getByRole('progressbar')).toBeVisible()
  expect(screen.getByText('Reading input 99.9%')).toBeVisible()
})

it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('fits complete input and generation labels at %s dark=%s', async (font, dark) => {
  setFontSize(font); document.documentElement.classList.toggle('dark', dark)
  useContextSummaryProgress.setState({ byThread: { a: { phase: 'summarizing', startedAt: Date.now() - 3600000, completed: 12, archived: true,
    input: { phase: 'generating', processed: 65536000, total: 65536000, cache: 123456789, request: 99999 } } } })
  render(withTranslations(<div style={{ width: 280 }} data-testid="generation-column"><ContextSummaryProgress threadId="a" /></div>))
  const column = screen.getByTestId('generation-column')
  await settle(column)
  expectNoHorizontalOverflow(column)
  expect(screen.getByText('Generating summary')).toBeVisible()
  expect(screen.queryByRole('progressbar')).toBeNull()
})
