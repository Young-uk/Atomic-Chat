import { useChatSessions } from '@/stores/chat-session-store'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/setup'
import { StrataControlPanel } from './StrataControlPanel'
import { controlLocalEngine, STRATA_MODEL, STRATA_PROVIDER, type LocalEngineSnapshot } from '@/services/managed-local-engine'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectFits, expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'
vi.mock('@/services/managed-local-engine', async original => ({
  ...(await original<typeof import('@/services/managed-local-engine')>()),
  controlLocalEngine: vi.fn(),
}))
const provider = { provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [{ id: STRATA_MODEL }], settings: [], api_key: '' } as ModelProvider
beforeEach(() => { vi.stubGlobal('IS_MACOS', true); vi.stubGlobal('IS_TAURI', true) })
afterEach(() => { cleanup(); useChatSessions.setState({ sessions: {}, requestActive: {} }); vi.unstubAllGlobals(); i18n.changeLanguage('en'); setFontSize(DEFAULT_FONT_SIZE); setTheme('light') })
for (const width of [1024, 1280]) for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) for (const theme of ['light', 'dark'] as const) for (const language of ['en', 'ko']) {
  it.each(['stopped', 'ready', 'loading', 'stopping', 'error'] as LocalEngineSnapshot['status'][])(`fits %s endpoint controls at ${width}/${font}/${theme}/${language}`, async status => {
    await page.viewport(width, 800); setFontSize(font); setTheme(theme); await i18n.changeLanguage(language)
    vi.mocked(controlLocalEngine).mockResolvedValue({ engine: 'strata', status, owned: status !== 'stopped', servedModels: [STRATA_MODEL], strataContext: 65536, activeContext: status === 'ready' ? 65536 : null, error: status === 'error' ? 'engineSummaryRecoveryRequired' : undefined })
    render(withTranslations(<div data-testid="surface" style={{ width: width - 304 }}><StrataControlPanel provider={provider} /></div>))
    await settle(screen.getByRole('button'))
    expectNoHorizontalOverflow(screen.getByTestId('surface'))
    expectFits(screen.getByRole('button'), screen.getByTestId('surface'))
    expect(screen.getByRole('button')).toBeVisible()
    if (status === 'ready') {
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '32768' } })
      await settle(screen.getByRole('spinbutton'))
      expectNoHorizontalOverflow(screen.getByTestId('surface'))
      for (const button of screen.getAllByRole('button')) expectFits(button, screen.getByTestId('surface'))
    }
  })
}

for (const language of ['en', 'ko']) for (const width of [640, 1024]) {
  it(`fits busy shutdown confirmation in ${language} at ${width}px`, async () => {
    await page.viewport(width, 800); setFontSize(XL_FONT_SIZE); await i18n.changeLanguage(language)
    vi.mocked(controlLocalEngine).mockResolvedValue({ engine: 'strata', status: 'ready', owned: true, servedModels: [STRATA_MODEL], strataContext: 131072 })
    useChatSessions.getState().setRequestActive('stuck-layout', true)
    render(withTranslations(<StrataControlPanel provider={provider} />))
    await settle(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    await settle(dialog)
    expectNoHorizontalOverflow(dialog)
    for (const button of dialog.querySelectorAll('button')) expectFits(button, dialog)
    expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(width)
  })
}
