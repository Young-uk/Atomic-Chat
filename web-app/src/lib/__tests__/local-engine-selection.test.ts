import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installLocalEngineSelection } from '../local-engine-selection'
import { localEngineCoordinator, STRATA_MODEL, STRATA_PROVIDER } from '@/services/managed-local-engine'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useServiceStore } from '@/hooks/useServiceHub'
import { useChatSessions } from '@/stores/chat-session-store'
import { seedServiceHub } from '@/test/service-hub'

vi.mock('@/services/managed-local-engine', async original => ({
  ...await original<typeof import('@/services/managed-local-engine')>(),
  localEngineCoordinator: { selectEngineTarget: vi.fn(), startSelected: vi.fn(), resume: vi.fn(), refresh: vi.fn(), configureBusy: vi.fn(), configurePrepare: vi.fn(), configureTransition: vi.fn() },
}))
beforeEach(() => {
  vi.clearAllMocks()
  useServiceStore.setState({ serviceHub: null })
  const model = { id: STRATA_MODEL, settings: {} } as Model
  useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: model, providers: [{
    provider: STRATA_PROVIDER, active: true, base_url: 'http://127.0.0.1:18080/v1', api_key: '', models: [model], settings: [],
  }] })
})

describe('persisted local selection startup', () => {
  it.each([[true, 'strata'], [false, 'strata'], [true, 'dstar'], [false, 'dstar']] as const)('waits for ServiceHub, restores selection with preload=%s for %s', (preload, engine) => {
    if (engine === 'dstar') useModelProvider.getState().updateProvider(STRATA_PROVIDER, { base_url: 'http://127.0.0.1:8010/v1' })
    useGeneralSetting.setState({ preloadModelOnStartup: preload })
    const dispose = installLocalEngineSelection()
    expect(localEngineCoordinator.selectEngineTarget).not.toHaveBeenCalled()
    seedServiceHub()
    expect(localEngineCoordinator.selectEngineTarget).toHaveBeenLastCalledWith({ engine, provider: STRATA_PROVIDER, model: STRATA_MODEL }, false)
    expect(localEngineCoordinator.startSelected).toHaveBeenCalledTimes(preload ? 1 : 0)
    dispose()
  })
  it('uses the latest selection when initialization was delayed', () => {
    useGeneralSetting.setState({ preloadModelOnStartup: true })
    const dispose = installLocalEngineSelection()
    useModelProvider.setState({ selectedProvider: '', selectedModel: null })
    seedServiceHub()
    expect(localEngineCoordinator.startSelected).not.toHaveBeenCalled()
    expect(localEngineCoordinator.selectEngineTarget).toHaveBeenLastCalledWith(null, false)
    dispose()
  })
  it('does not start a remote endpoint, and resumes a deferred selection after tools finish', () => {
    useModelProvider.setState({ selectedProvider: '', selectedModel: null })
    useGeneralSetting.setState({ preloadModelOnStartup: true })
    seedServiceHub()
    const dispose = installLocalEngineSelection()
    expect(localEngineCoordinator.startSelected).not.toHaveBeenCalled()
    useModelProvider.getState().selectModelProvider(STRATA_PROVIDER, STRATA_MODEL)
    expect(localEngineCoordinator.selectEngineTarget).toHaveBeenLastCalledWith({ engine: 'strata', provider: STRATA_PROVIDER, model: STRATA_MODEL })
    useChatSessions.getState().setRequestActive('tools', true)
    useChatSessions.getState().setRequestActive('tools', false)
    expect(localEngineCoordinator.resume).toHaveBeenCalled()
    dispose()
  })
})
