import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelContextSlider } from './ModelContextSlider'
import { withTranslations } from '@/test/layout'
afterEach(cleanup)
it('uses the model window and reports slider edits without changing the saved value', () => {
  const change = vi.fn()
  const { rerender } = render(withTranslations(<ModelContextSlider value={65536} min={16384} max={262144} onChange={change} />))
  const slider = screen.getByRole('slider')
  expect(slider).toHaveAttribute('max', '262144')
  expect(slider).toHaveValue('65536')
  fireEvent.change(slider, { target: { value: '131072' } })
  expect(change).toHaveBeenCalledWith(131072)
  rerender(withTranslations(<ModelContextSlider value={524288} min={16384} max={262144} onChange={change} disabled />))
  expect(slider).toHaveValue('262144')
  expect(slider).toBeDisabled()
  expect(change).toHaveBeenCalledTimes(1)
})
it('does not invent a maximum when metadata is missing', () => {
  render(withTranslations(<ModelContextSlider value={65536} min={16384} onChange={vi.fn()} />))
  expect(screen.queryByRole('slider')).toBeNull()
})
