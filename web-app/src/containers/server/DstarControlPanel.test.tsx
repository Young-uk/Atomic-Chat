import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DstarControlPanel } from './DstarControlPanel'
import type { DstarSnapshot } from '@/services/dstar'

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
vi.mock('@/hooks/useServiceHub', () => ({
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
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const base: DstarSnapshot = {
  available: true,
  status: 'stopped',
  owned: false,
  selection: { model: 'iq3', context: 65536 },
  models: [
    { id: 'iq3', name: 'Qwen IQ3', available: true, bytes: 16 },
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
const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

describe('Dstar local control panel', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_MACOS', true)
    vi.useFakeTimers()
    vi.clearAllMocks()
    mock.control.mockReset().mockResolvedValue(base)
    mock.checked.mockResolvedValue({ ok: true, modelCount: 1, latencyMs: 1 })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts once and keeps Stop available while the model is loading', async () => {
    render(<DstarControlPanel />)
    await flush()
    const loading = { ...base, status: 'loading', owned: true }
    mock.control.mockResolvedValue(loading)
    fireEvent.click(
      screen.getByRole('button', { name: 'endpoints:dstar.start' })
    )
    await flush()
    expect(mock.control).toHaveBeenCalledWith('start', base.selection)
    expect(screen.getByRole('status').textContent).toContain(
      'endpoints:dstar.status.loading'
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'endpoints:dstar.stop' })
    )
    await flush()
    expect(mock.control).toHaveBeenCalledWith('stop', undefined)
  })

  it('does not trust an old Connected label or stop an externally started server', async () => {
    mock.control.mockResolvedValue({
      ...base,
      status: 'external',
      servedModels: ['qwen-chat'],
    })
    render(<DstarControlPanel />)
    await flush()
    expect(screen.getByRole('status').textContent).toContain(
      'endpoints:dstar.status.external'
    )
    expect(
      screen.getByRole('button', { name: 'endpoints:dstar.start' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'endpoints:dstar.stop' })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'endpoints:dstar.useInChat' })
    )
    expect(mock.select).toHaveBeenCalledWith('dstar-test', 'qwen-chat')
  })

  it('requires confirmation before reloading with changed context', async () => {
    mock.control.mockResolvedValue({
      ...base,
      status: 'ready',
      owned: true,
      servedModels: ['qwen-chat'],
    })
    render(<DstarControlPanel />)
    await flush()
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '32768' },
    })
    expect(mock.restart).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'endpoints:dstar.restart' })
    )
    const dialog = screen.getByRole('dialog')
    mock.restart.mockResolvedValue({ ...base, status: 'loading', owned: true })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'endpoints:dstar.restart' })
    )
    await flush()
    expect(mock.restart).toHaveBeenCalledWith({ model: 'iq3', context: 32768 })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'endpoints:dstar.status.loading'
    )
  })

  it('does not offer an incomplete model as runnable', async () => {
    mock.control.mockResolvedValue({
      ...base,
      models: base.models.map((model) => ({
        ...model,
        available: false,
        reason: 'incompleteFiles',
      })),
    })
    render(<DstarControlPanel />)
    await flush()
    expect(
      screen.getByRole('button', { name: 'endpoints:dstar.start' })
    ).toBeDisabled()
  })

  it('stops polling when the panel leaves the page', async () => {
    const view = render(<DstarControlPanel />)
    await flush()
    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(mock.control).toHaveBeenCalledTimes(1)
    expect(view.container).toBeEmptyDOMElement()
  })
})
