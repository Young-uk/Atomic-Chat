import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FontSizeSwitcher } from './FontSizeSwitcher'
import { Card, CardItem } from './Card'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { expectNoHorizontalOverflow, settle, withTranslations } from '@/test/layout'

afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); useInterfaceSettings.getState().setFontScale(100) })
it.each([75, 100, 125, 200].flatMap(scale => [false, true].map(dark => ({scale, dark}))))('fits at $scale percent (dark: $dark) with the sidebar open', async ({scale, dark}) => {
  document.documentElement.classList.toggle('dark', dark)
  useInterfaceSettings.getState().setFontScale(scale)
  render(withTranslations(<div className="app-shell" style={{width: 720}} data-testid="page">
    <Card title="Interface"><CardItem title="Text size" description="Scale interface text while keeping the original size hierarchy."
      className="flex-col items-start gap-3 lg:flex-row lg:items-center"
      classNameWrapperAction="w-full min-w-0 lg:w-[min(24rem,50%)]"
      actions={<FontSizeSwitcher />} /></Card>
    <p className="text-base" data-testid="sample">Aa · 123</p>
  </div>))
  await settle()
  expectNoHorizontalOverflow(screen.getByTestId('page'))
  expectNoHorizontalOverflow(screen.getByTestId('font-scale-control'))
  expect(parseFloat(getComputedStyle(screen.getByTestId('sample')).fontSize)).toBeCloseTo(13 * scale / 100, 2)
  expect(screen.getByRole('slider')).toHaveValue(String(scale))
  const button = screen.getByRole('button', {name: '100%'})
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(parseFloat(getComputedStyle(button).lineHeight))
})
