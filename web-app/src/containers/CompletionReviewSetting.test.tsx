import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CompletionReviewSetting from './CompletionReviewSetting'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import en from '@/locales/en/settings.json'
import ko from '@/locales/ko/settings.json'

beforeEach(() => {
  vi.stubEnv('VITE_PERSONAL_BUILD', 'true')
  useGeneralSetting.setState({ completionReviewEnabled: false })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

function view(copy: typeof en.chatBehavior | typeof ko.chatBehavior) {
  return render(
    <TranslationContext.Provider value={{ i18n, t: ((key: string) =>
      copy[key.split('.').pop() as keyof typeof copy] ?? key) as typeof i18n.t }}>
      <CompletionReviewSetting />
    </TranslationContext.Provider>
  )
}

it.each([en.chatBehavior, ko.chatBehavior])('shows translated limitations and toggles the global preference', (copy) => {
  view(copy)
  const toggle = screen.getByRole('switch', { name: copy.completionReview })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(toggle).toHaveAccessibleDescription(copy.completionReviewDesc)
  fireEvent.click(toggle)
  expect(useGeneralSetting.getState().completionReviewEnabled).toBe(true)
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(toggle)
  expect(useGeneralSetting.getState().completionReviewEnabled).toBe(false)
})

it('does not expose the experimental setting outside personal builds', () => {
  vi.stubEnv('VITE_PERSONAL_BUILD', 'false')
  view(en.chatBehavior)
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
