import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/setup'
import { LocalEngineStatus } from './LocalEngineStatus'
import { useModelProvider } from '@/hooks/useModelProvider'
import { STRATA_MODEL, STRATA_PROVIDER, useLocalEngine, type LocalEngineState } from '@/services/managed-local-engine'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectFits, expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'

beforeEach(() => {
  vi.stubGlobal('IS_TAURI', true)
  const model = { id: STRATA_MODEL, capabilities: ['vision', 'tools'], settings: {} } as Model
  useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model, providers: [{
    provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [model], settings: [], api_key: '',
  }] })
})
afterEach(() => { i18n.changeLanguage('en'); cleanup(); vi.unstubAllGlobals(); setFontSize(DEFAULT_FONT_SIZE); setTheme('light') })
for (const language of ['en', 'ko']) for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) for (const theme of ['light', 'dark'] as const) {
  it.each(['loading', 'waiting', 'stopping', 'ready', 'error', 'idle'] as LocalEngineState['phase'][])(
    `fits %s in a narrow model panel at ${font}, ${theme}, ${language}`,
    async phase => {
      i18n.changeLanguage(language)
      setFontSize(font); setTheme(theme)
      useLocalEngine.setState({ target: { engine: 'strata', provider: STRATA_PROVIDER, model: STRATA_MODEL }, phase,
        error: phase === 'error' ? 'foreignEngine' : undefined,
        snapshot: { engine: 'strata', status: 'loading', owned: true, servedModels: [], elapsedSeconds: 999 },
      }, true)
      render(withTranslations(<div data-testid="panel" style={{ width: 300 }}><LocalEngineStatus /></div>))
      const panel = screen.getByTestId('panel')
      await settle(panel)
      expectNoHorizontalOverflow(panel)
      for (const button of screen.queryAllByRole('button')) expectFits(button, panel)
      expect(screen.getByText(/Strata IQ3_XXS/)).toBeVisible()
    }
  )
}
