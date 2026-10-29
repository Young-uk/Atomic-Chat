import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DstarControlPanel } from './DstarControlPanel'
import type { DstarSnapshot } from '@/services/dstar'
import {
  expectFits,
  expectNoHorizontalOverflow,
  settle,
  withTranslations,
  setFontSize,
} from '@/test/layout'
const mock = vi.hoisted(() => ({
  control: vi.fn(),
  restart: vi.fn(),
  select: vi.fn(),
  checked: vi.fn(),
  endpoint: vi.fn(),
}))
vi.mock('@/services/dstar', async (original) => ({
  ...(await original<typeof import('@/services/dstar')>()),
  controlDstar: mock.control,
  restartDstar: mock.restart,
}))
vi.mock('@/hooks/useServiceHub', async (original) => ({
  ...(await original<typeof import('@/hooks/useServiceHub')>()),
  useServiceHub: () => ({
    providers: () => ({ checkProviderEndpoint: mock.checked }),
  }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: object) => unknown) =>
    selector({
      providers: [
        {
          provider: 'dstar-test',
          base_url: 'http://127.0.0.1:8010/v1',
          models: [{ id: 'qwen-chat', name: 'Qwen Chat' }],
        },
      ],
      selectModelProvider: mock.select,
    }),
}))
vi.mock('@/stores/endpoint-check-store', () => ({
  useEndpointCheckStore: { getState: () => ({ setResult: mock.endpoint }) },
}))
vi.mock('@/lib/platform/utils', async (original) => ({
  ...(await original<typeof import('@/lib/platform/utils')>()),
  isPlatformTauri: () => true,
}))

const base: DstarSnapshot = {
  available: true,
  status: 'stopped',
  owned: false,
  selection: { model: 'iq3', context: 65536 },
  models: [
    {
      id: 'iq3',
      name: 'Qwen3.8 Flash Next GSQ RCO with an exceptionally long model name IQ3_XXS',
      available: true,
      bytes: 16,
    },
    {
      id: 'q2',
      name: 'Qwen Q2',
      available: false,
      reason: 'missingFiles',
      bytes: 0,
    },
  ],
  servedModels: [],
  elapsedSeconds: 0,
  log: '',
}

beforeEach(() => {
  vi.stubGlobal('IS_MACOS', true)
  mock.control.mockResolvedValue({
    ...base,
    owned: true,
    status: 'ready',
    servedModels: ['qwen-chat'],
  })
  mock.checked.mockResolvedValue({ ok: true, latencyMs: 1, modelCount: 1 })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setFontSize('16px')
})
it.each([420, 676, 1000])(
  'fits controls and long model names within a %spx column',
  async (width) => {
    setFontSize('20px')
    const view = render(
      withTranslations(
        <div style={{ width }} data-testid="column">
          <DstarControlPanel />
        </div>
      )
    )
    await screen.findByRole('button', { name: 'Stop Dstar' })
    const column = screen.getByTestId('column')
    await settle(column)
    const unavailable = screen.getByText('Qwen Q2', { exact: false })
    expect(unavailable).not.toBeVisible()
    const disclosure = screen.getByText('Show uninstalled models')
    disclosure.click()
    expect(unavailable).toBeVisible()
    disclosure.click()
    expect(unavailable).not.toBeVisible()
    expectNoHorizontalOverflow(column)
    expectFits(screen.getByRole('button', { name: 'Stop Dstar' }), column)
    expect(screen.getByRole('spinbutton')).toHaveValue(65536)
    view.unmount()
  }
)
