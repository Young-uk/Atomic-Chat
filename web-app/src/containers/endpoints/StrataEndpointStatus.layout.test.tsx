import { cleanup, render, screen } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/i18n/setup'
import { StrataControlPanel } from '../server/StrataControlPanel'
import { EndpointCard } from './EndpointCard'
import { controlLocalEngine, STRATA_MODEL, STRATA_PROVIDER, type LocalEngineSnapshot } from '@/services/managed-local-engine'
import { DEFAULT_FONT_SIZE, XL_FONT_SIZE, expectFits, expectNoHorizontalOverflow, setFontSize, setTheme, settle, withTranslations } from '@/test/layout'
vi.mock('@/services/managed-local-engine', async original => ({
  ...(await original<typeof import('@/services/managed-local-engine')>()),
  controlLocalEngine: vi.fn(),
}))
const provider = { provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', models: [{ id: STRATA_MODEL }], settings: [], api_key: '' } as ModelProvider
beforeEach(() => { vi.stubGlobal('IS_MACOS', true); vi.stubGlobal('IS_TAURI', true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); i18n.changeLanguage('en'); setFontSize(DEFAULT_FONT_SIZE); setTheme('light') })
for (const width of [1024, 1280]) for (const font of [DEFAULT_FONT_SIZE, XL_FONT_SIZE]) for (const theme of ['light', 'dark'] as const) for (const language of ['en', 'ko']) {
  it.each(['stopped', 'ready', 'loading', 'stopping', 'error', 'external'] as LocalEngineSnapshot['status'][])(`fits %s live endpoint header and controls at ${width}/${font}/${theme}/${language}`, async status => {
    await page.viewport(width, 800); setFontSize(font); setTheme(theme); await i18n.changeLanguage(language)
    vi.mocked(controlLocalEngine).mockResolvedValue({ engine: 'strata', status, owned: status !== 'stopped', servedModels: [STRATA_MODEL], error: status === 'error' ? 'engineSummaryRecoveryRequired' : undefined })
    render(withTranslations(<div data-testid="surface" style={{ width: width - 304 }}><EndpointCard provider={provider} expanded={false} onToggleExpanded={() => {}} onConnectMedia={() => {}} onPing={() => {}} onConfigure={() => {}} serverControls={<StrataControlPanel provider={provider} />} /></div>))
    await settle(screen.getAllByRole('button')[0])
    expectNoHorizontalOverflow(screen.getByTestId('surface'))
    expectFits(screen.getAllByRole('button')[0], screen.getByTestId('surface'))
    expect(screen.getAllByRole('button')[0]).toBeVisible()
  })
}
