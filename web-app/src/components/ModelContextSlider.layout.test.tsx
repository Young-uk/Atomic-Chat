import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ModelContextSlider } from './ModelContextSlider'
import { expectNoHorizontalOverflow, settle, setFontSize, withTranslations } from '@/test/layout'
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); setFontSize('13px') })
for (const width of [1024, 1280]) for (const font of ['16px', '20px']) for (const dark of [false, true]) {
  it(`keeps numeric context and slider beside each other: ${width}, ${font}, dark=${dark}`, async () => {
    setFontSize(font); document.documentElement.classList.toggle('dark', dark)
    render(withTranslations(<div data-testid="column" style={{ width: (width - 360) / 2 }}>
      <div className="grid min-w-0 grid-cols-[minmax(7rem,0.4fr)_minmax(0,1fr)] items-center gap-3">
        <input aria-label="Context" className="w-full min-w-0" type="number" value={65536} readOnly />
        <ModelContextSlider value={65536} min={16384} max={262144} onChange={() => {}} />
      </div>
    </div>))
    const column = screen.getByTestId('column'); await settle(column)
    expectNoHorizontalOverflow(column)
    expect(screen.getByRole('slider')).toBeVisible()
    expect(screen.getByRole('slider').getBoundingClientRect().width).toBeGreaterThan(60)
  })
}
