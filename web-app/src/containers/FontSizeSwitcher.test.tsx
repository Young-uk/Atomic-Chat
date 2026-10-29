import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FontSizeSwitcher } from './FontSizeSwitcher'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'

vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => { useInterfaceSettings.getState().setFontScale(100) })

it('keeps slider, percentage selection and the original-size action synchronized', () => {
  render(<FontSizeSwitcher />)
  const slider = screen.getByRole('slider')
  const select = screen.getByRole('combobox')
  expect(slider).toHaveValue('100')
  fireEvent.change(slider, { target: { value: '125' } })
  expect(select).toHaveValue('125')
  expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('16.25px')
  fireEvent.change(select, { target: { value: '200' } })
  expect(slider).toHaveValue('200')
  expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('26px')
  fireEvent.click(screen.getByRole('button', { name: '100%' }))
  expect(slider).toHaveValue('100')
  expect(select).toHaveValue('100')
})
