import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Reasoning, ReasoningContent, ReasoningTrigger } from './reasoning'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('16px') })
it.each([['16px', false], ['20px', false], ['16px', true], ['20px', true]] as const)('keeps ranges literal and readable at %s dark=%s', async (font, dark) => {
  setFontSize(font); document.documentElement.classList.toggle('dark', dark)
  const text = 'Each draw has 조 1~5, each with numbers 000000~999999. Total 1,000만 매 (판매점/인터넷 각각 500만매).'
  render(withTranslations(<div style={{ width: 320 }} data-testid="range-column">
    <Reasoning defaultOpen><ReasoningTrigger /><ReasoningContent>{text}</ReasoningContent></Reasoning>
  </div>))
  const column = screen.getByTestId('range-column')
  await waitFor(() => expect(column).toHaveTextContent(text))
  await settle(column)
  expect(column.querySelector('del')).toBeNull()
  expectNoHorizontalOverflow(column)
})
