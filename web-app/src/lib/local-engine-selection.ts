import { useAppState } from '@/hooks/useAppState'
import { getServiceHub, useServiceStore } from '@/hooks/useServiceHub'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { isLocalEngineBusy } from '@/hooks/useLocalEngineBusy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useChatSessions } from '@/stores/chat-session-store'
import { controlLocalEngine, localEngineCoordinator, localEngineTarget } from '@/services/managed-local-engine'

/** Install after synchronous settings hydration, once per renderer lifetime. */
export function installLocalEngineSelection(): () => void {
  localEngineCoordinator.configureBusy(isLocalEngineBusy)
  localEngineCoordinator.configureTransition({
    quiesce: engine => controlLocalEngine('quiesce', engine),
    resume: () => controlLocalEngine('resume', null),
  })
  localEngineCoordinator.configurePrepare(async () => {
    // Fail closed rather than co-loading a second large local model. Other
    // engines retain their own unload controls and process ownership.
    if (useAppState.getState().loadingModel ||
        (await getServiceHub().models().getActiveModels()).length > 0) {
      throw new Error('otherLocalEngine')
    }
  })
  const selected = () => {
    const state = useModelProvider.getState()
    return localEngineTarget(state.getProviderByName(state.selectedProvider), state.selectedModel)
  }
  let initialized = false
  const initialize = () => {
    if (initialized || !useServiceStore.getState().serviceHub) return
    initialized = true
    localEngineCoordinator.selectEngineTarget(selected(), false)
    if (useGeneralSetting.getState().preloadModelOnStartup && selected()) {
      localEngineCoordinator.startSelected(selected()!)
    }
  }
  const unservice = useServiceStore.subscribe(initialize)
  initialize()
  const unselect = useModelProvider.subscribe(() => {
    if (initialized) localEngineCoordinator.selectEngineTarget(selected())
  })
  const unbusy = useChatSessions.subscribe(() => localEngineCoordinator.resume())
  const timer = setInterval(() => { if (initialized) void localEngineCoordinator.refresh() }, 2000)
  const unagent = useAgentRun.subscribe(() => localEngineCoordinator.resume())
  return () => { clearInterval(timer); unselect(); unbusy(); unagent(); unservice(); localEngineCoordinator.selectEngineTarget(null) }
}
