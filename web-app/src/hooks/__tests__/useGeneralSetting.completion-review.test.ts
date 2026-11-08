import { beforeEach, describe, expect, it } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { useGeneralSetting } from '../useGeneralSetting'

const save = (state: Record<string, unknown>) => localStorage.setItem(
  localStorageKey.settingGeneral, JSON.stringify({ state, version: 5 })
)

beforeEach(() => {
  localStorage.clear()
  useGeneralSetting.setState(useGeneralSetting.getInitialState(), true)
})

describe('completion review opt-in persistence', () => {
  it('defaults off for a new install', () => {
    expect(useGeneralSetting.getInitialState().completionReviewEnabled).toBe(false)
  })

  it('adds an off default without resetting existing preferences', async () => {
    save({ currentLanguage: 'ko', reasoningBudget: 'max', disableReasoning: false,
      agentModeEnabled: true, preloadModelOnStartup: true, localScanFolders: ['/models'] })
    await useGeneralSetting.persist.rehydrate()
    expect(useGeneralSetting.getState()).toMatchObject({ completionReviewEnabled: false,
      currentLanguage: 'ko', reasoningBudget: 'max', disableReasoning: false,
      agentModeEnabled: true, preloadModelOnStartup: true, localScanFolders: ['/models'] })
  })

  it.each([undefined, null, false, 'true', 'false', 1, 0, {}, []])(
    'does not opt in for malformed or absent value %j', async (value) => {
      useGeneralSetting.setState({ completionReviewEnabled: true })
      save({ completionReviewEnabled: value })
      await useGeneralSetting.persist.rehydrate()
      expect(useGeneralSetting.getState().completionReviewEnabled).toBe(false)
    }
  )

  it.each([true, false])('persists and rehydrates explicit %s', async (enabled) => {
    useGeneralSetting.getState().setCompletionReviewEnabled(enabled)
    const saved = localStorage.getItem(localStorageKey.settingGeneral)!
    expect(JSON.parse(saved)).toMatchObject({ version: 5, state: { completionReviewEnabled: enabled } })
    useGeneralSetting.setState({ completionReviewEnabled: !enabled })
    localStorage.setItem(localStorageKey.settingGeneral, saved)
    await useGeneralSetting.persist.rehydrate()
    expect(useGeneralSetting.getState().completionReviewEnabled).toBe(enabled)
    expect(typeof useGeneralSetting.getState().setCompletionReviewEnabled).toBe('function')
  })
})
