import { beforeEach, expect, it } from 'vitest'
import { migrateFontScale, normalizeFontScale, useInterfaceSettings } from '../useInterfaceSettings'
import { localStorageKey } from '@/constants/localStorage'

beforeEach(() => { localStorage.clear() })
it('preserves legacy choices near their original size and respects the previous migration', () => {
  expect(migrateFontScale({fontSize:'13px'}, 1)).toBe(100)
  expect(migrateFontScale({fontSize:'16px'}, 1)).toBe(125)
  expect(migrateFontScale({fontSize:'20px'}, 1)).toBe(155)
  expect(migrateFontScale({fontSize:'16px'}, 0)).toBe(100)
  expect(normalizeFontScale(NaN)).toBe(100)
  expect(normalizeFontScale(0)).toBe(75)
  expect(normalizeFontScale(500)).toBe(200)
  expect(normalizeFontScale(128)).toBe(130)
})
it('restores the selected percentage and CSS size after rehydration', async () => {
  useInterfaceSettings.getState().setFontScale(175)
  const saved = localStorage.getItem(localStorageKey.settingInterface)!
  useInterfaceSettings.getState().setFontScale(100)
  localStorage.setItem(localStorageKey.settingInterface, saved)
  await useInterfaceSettings.persist.rehydrate()
  expect(useInterfaceSettings.getState().fontScale).toBe(175)
  expect(document.documentElement.style.getPropertyValue('--font-size-base')).toBe('22.75px')
})
it('migrates the actual version-one stored preference before applying CSS', async () => {
  localStorage.setItem(localStorageKey.settingInterface, JSON.stringify({
    version: 1, state: { fontSize: '20px', accentColor: 'primary' },
  }))
  await useInterfaceSettings.persist.rehydrate()
  expect(useInterfaceSettings.getState().fontScale).toBe(155)
  expect(useInterfaceSettings.getState().fontSize).toBe('20.15px')
  expect(JSON.parse(localStorage.getItem(localStorageKey.settingInterface)!).version).toBe(2)
})
