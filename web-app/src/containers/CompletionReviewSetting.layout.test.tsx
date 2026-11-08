import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from '@vitest/browser/context'
import CompletionReviewSetting from './CompletionReviewSetting'
import { Card } from './Card'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import en from '@/locales/en/settings.json'
import ko from '@/locales/ko/settings.json'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectNoHorizontalOverflow, setFontSize, setTheme, settle } from '@/test/layout'

vi.mock('@/lib/personal-build', () => ({ isPersonalBuild: () => true }))

afterEach(() => { cleanup(); setTheme('light'); setFontSize(DEFAULT_FONT_SIZE) })

for (const width of [1024, 1280]) {
  for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) {
    for (const theme of ['light', 'dark'] as const) {
      for (const [language, copy] of [['en', en.chatBehavior], ['ko', ko.chatBehavior]] as const) {
        it(`fits ${width}px / ${font} / ${theme} / ${language} with sidebar open`, async () => {
          await page.viewport(width, 900)
          setFontSize(font)
          setTheme(theme)
          // At 1024 the sidebar overlays; at 1280 it occupies 256px.
          const overlay = width < 1052
          render(
            <TranslationContext.Provider value={{ i18n, t: ((key: string) =>
              copy[key.split('.').pop() as keyof typeof copy] ?? key) as typeof i18n.t }}>
              <div data-testid="desktop" style={{ width: '100%', display: 'flex', position: 'relative' }}>
                <aside aria-label="Sidebar" style={{ width: 256, flexShrink: 0, position: overlay ? 'absolute' : 'relative' }} />
                <main data-testid="settings" style={{ flex: 1, minWidth: 0, padding: 24 }}>
                  <Card title={copy.title}><CompletionReviewSetting /></Card>
                </main>
              </div>
            </TranslationContext.Provider>
          )
          const desktop = screen.getByTestId('desktop')
          await settle(desktop)
          expectNoHorizontalOverflow(desktop)
          expectNoHorizontalOverflow(screen.getByTestId('settings'))
          const toggle = screen.getByRole('switch', { name: copy.completionReview })
          expect(toggle.getBoundingClientRect().width).toBeGreaterThan(20)
          expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(width)
        })
      }
    }
  }
}
