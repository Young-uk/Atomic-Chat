import { useEffect } from 'react'
import { create } from 'zustand'
import { controlLocalEngine, localEngineTarget, STRATA_MODEL, useLocalEngine, type LocalEngineSnapshot } from '@/services/managed-local-engine'

export type StrataEndpointStatus = { snapshot?: LocalEngineSnapshot; error?: string }
export function strataEndpointPhase({ snapshot, error }: StrataEndpointStatus) {
  return error ? 'unknown' : !snapshot ? 'checking' :
    snapshot.engine && snapshot.engine !== 'strata' ? 'stopped' :
    snapshot.error ? 'error' : snapshot.status === 'ready' &&
      (snapshot.engine !== 'strata' || !snapshot.owned || !snapshot.servedModels.includes(STRATA_MODEL)) ? 'unknown' : snapshot.status
}
const useStatus = create<StrataEndpointStatus>(() => ({}))
let observers = 0
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | undefined
let actionPending = false
let inFlight = false
let freshnessTimer: ReturnType<typeof setTimeout> | undefined

function publish(status: StrataEndpointStatus) {
  clearTimeout(freshnessTimer)
  useStatus.setState(status, true)
  // Bound the displayed observation, not just one IPC generation: a lifecycle
  // completion or focus refresh may supersede a still-blocked status request.
  if (observers && !document.hidden && !status.error &&
      (!status.snapshot || status.snapshot.status === 'ready')) {
    freshnessTimer = setTimeout(() => {
      revision++
      useStatus.setState({ error: 'statusTimeout' }, true)
    }, 5000)
  }
}

/** Status identity is independent of whether this endpoint is enabled for chat. */
export function isRegisteredStrata(provider: ModelProvider) {
  return IS_MACOS && IS_TAURI && localEngineTarget({ ...provider, active: true }, { id: STRATA_MODEL })?.engine === 'strata'
}

function clearTimer() { clearTimeout(timer); timer = undefined }
async function poll() {
  clearTimer()
  if (!observers || document.hidden || actionPending || inFlight) return
  const current = ++revision
  inFlight = true
  // Keep only one outstanding IPC, including after its display has expired.
  try {
    const snapshot = await controlLocalEngine('status', 'strata')
    if (current === revision && observers) publish({ snapshot })
  } catch (reason) {
    if (current === revision && observers) publish({ error: String(reason) })
  } finally {
    inFlight = false
    if (observers && !document.hidden && !actionPending) timer = setTimeout(() => void poll(), current === revision ? 1000 : 0)
  }
}
function refresh() {
  revision++
  clearTimer()
  if (actionPending) return
  publish({})
  void poll()
}

/** Invalidate reads before a lifecycle action; old ready replies cannot revive it. */
export function beginStrataStatusAction(status: 'loading' | 'stopping') {
  actionPending = true
  revision++
  clearTimer()
  const previous = useStatus.getState().snapshot
  publish({ snapshot: { engine: 'strata', status, owned: previous?.owned ?? false, servedModels: [],
    strataContext: previous?.strataContext, activeContext: previous?.activeContext } })
}
export function finishStrataStatusAction(snapshot?: LocalEngineSnapshot, error?: string) {
  actionPending = false
  revision++
  publish(document.hidden ? {} : { snapshot, error })
  if (observers) timer = setTimeout(() => void poll(), 1000)
}

/** One non-persisted, native status-only observation for header and controls.
 * No URL probing, model loading, configuration writes, or ownership inference. */
export function useStrataEndpointStatus(enabled: boolean): StrataEndpointStatus {
  const status = useStatus()
  useEffect(() => {
    if (!enabled) return
    if (++observers === 1) {
      refresh()
      document.addEventListener('visibilitychange', refresh)
      window.addEventListener('focus', refresh)
      const identity = (state: ReturnType<typeof useLocalEngine.getState>) => JSON.stringify([
        state.target, state.phase, state.error, state.snapshot?.engine,
        state.snapshot?.status, state.snapshot?.owned, state.snapshot?.error,
        state.snapshot?.servedModels,
      ])
      unsubscribe = useLocalEngine.subscribe((next, previous) => {
        if (identity(next) !== identity(previous)) refresh()
      })
    }
    return () => {
      if (--observers === 0) {
        revision++
        clearTimer()
        unsubscribe?.()
        document.removeEventListener('visibilitychange', refresh)
        window.removeEventListener('focus', refresh)
        publish({})
      }
    }
  }, [enabled])
  return enabled ? status : {}
}
