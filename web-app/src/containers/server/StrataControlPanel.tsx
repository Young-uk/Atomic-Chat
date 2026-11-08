import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isLocalEngineBusy, useLocalEngineBusy } from '@/hooks/useLocalEngineBusy'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { controlLocalEngine, localEngineCoordinator, useLocalEngine, localEngineTarget, STRATA_MODEL } from '@/services/managed-local-engine'

import { beginStrataStatusAction, finishStrataStatusAction, strataEndpointPhase, useStrataEndpointStatus } from '@/hooks/useStrataEndpointStatus'

/** Explicit controls share the native owner; viewing the card is read-only. */
export function StrataControlPanel({ provider }: { provider: ModelProvider }) {
  const { t } = useTranslation()
  const chatBusy = useLocalEngineBusy()
  const enginePhase = useLocalEngine(state => state.phase)
  const engineTransition = ['loading', 'waiting', 'stopping'].includes(enginePhase)
  const selectedProvider = useModelProvider(store => store.selectedProvider)
  const selectedModel = useModelProvider(store => store.selectedModel)
  const selectModel = useModelProvider(store => store.selectModelProvider)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string>()
  const draftEdited = useRef(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const inAction = useRef(false)
  const alive = useRef(false)
  const selectOnReady = useRef(false)
  useEffect(() => { selectOnReady.current = false }, [selectedProvider, selectedModel])
  const target = localEngineTarget(provider, { id: STRATA_MODEL })
  const supported = IS_MACOS && IS_TAURI && target?.engine === 'strata'

  const { snapshot, error: statusError } = useStrataEndpointStatus(Boolean(supported))
  const phase = strataEndpointPhase({ snapshot, error: statusError })
  useEffect(() => {
    // Polls may update saved settings, but must not replace an unsaved edit.
    if (snapshot && !draftEdited.current) setDraft(String(snapshot.strataContext ?? 65536))
  }, [snapshot])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (selectOnReady.current && phase === 'ready' && snapshot?.engine === 'strata' &&
        snapshot.owned && snapshot.servedModels.includes(STRATA_MODEL)) {
      selectOnReady.current = false
      if (!isLocalEngineBusy()) {
        const target = localEngineTarget(provider, { id: STRATA_MODEL })
        if (target) localEngineCoordinator.reconcileReady(target, snapshot)
        selectModel(provider.provider, STRATA_MODEL)
      }
    }
  }, [snapshot, phase, selectModel, provider])

  if (!supported) return null
  const owned = snapshot?.engine === 'strata' && snapshot.owned
  const transitioning = snapshot?.status === 'loading' || snapshot?.status === 'stopping'
  const context = Number(draft)
  const validContext = draft !== undefined && Number.isInteger(context) && context >= 16384 && context <= 65536
  const dirty = validContext && (context !== (snapshot?.strataContext ?? 65536) || (owned && snapshot?.activeContext != null && context !== snapshot.activeContext))
  const run = async (action: 'ensure' | 'stop') => {
    if (inAction.current || isLocalEngineBusy() || !snapshot || snapshot.status === 'external' ||
        (action === 'ensure' && (engineTransition || transitioning || !validContext))) return
    setConfirmRestart(false)
    inAction.current = true
    beginStrataStatusAction(action === 'stop' ? 'stopping' : 'loading')
    setBusy(true); setError(undefined)
    selectOnReady.current = action === 'ensure'
    try {
      if (action === 'ensure') await localEngineCoordinator.prepareStart()
      if (action === 'stop' && useLocalEngine.getState().target?.engine === 'strata') {
        localEngineCoordinator.cancel()
        await localEngineCoordinator.settled()
        const state = useLocalEngine.getState()
        if (state.phase === 'error') throw new Error(state.error || 'stopFailed')
      }
      const next = action === 'ensure'
        ? await controlLocalEngine('ensure', 'strata', context)
        : await controlLocalEngine(useLocalEngine.getState().target?.engine === 'strata' ? 'status' : 'stop', 'strata')
      if (action === 'ensure' && !next.error && next.status !== 'error' &&
          next.strataContext === context) {
        draftEdited.current = false
        if (alive.current) setDraft(String(next.strataContext))
      }
      // The status store rejects older in-flight polls across this action.
      finishStrataStatusAction(next)
    } catch (reason) {
      selectOnReady.current = false
      finishStrataStatusAction(undefined, String(reason))
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      inAction.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section aria-label={t('endpoints:localEngine.strataTitle')} className="min-w-0 pt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">{t('endpoints:localEngine.strataTitle')}</h2>
          <p role="status" className="mt-1 break-words text-sm text-muted-foreground">
            {phase === 'unknown' ? t('endpoints:status.unverified') : phase === 'checking' ? t('endpoints:status.checking') : t(`endpoints:dstar.status.${phase}`)}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
        {owned && dirty && <Button size="sm" disabled={busy || chatBusy || engineTransition || transitioning || !validContext}
          onClick={() => setConfirmRestart(true)}>{t('endpoints:dstar.restart')}</Button>}
        <Button size="sm" variant={owned ? 'outline' : 'default'}
          disabled={busy || chatBusy || !snapshot || snapshot.status === 'external' ||
            (owned ? snapshot.status === 'stopping' : transitioning || engineTransition || !validContext)}
          onClick={() => void run(owned ? 'stop' : 'ensure')}>
          {t(owned ? 'endpoints:localEngine.stop' : 'endpoints:localEngine.retry')}
        </Button>
        </div>
      </div>
      {snapshot && <div className="mt-3 min-w-0">
        <label className="block text-sm" htmlFor="strata-context">{t('endpoints:dstar.context')}</label>
        <input id="strata-context" type="number" min={16384} max={65536} step={1}
          value={draft ?? ''} aria-invalid={draft !== undefined && !validContext}
          disabled={busy || chatBusy || transitioning || engineTransition || snapshot.status === 'external'}
          onChange={event => {
            draftEdited.current = event.target.value !== String(snapshot.strataContext ?? 65536)
            setDraft(event.target.value)
          }}
          className="mt-1 w-full min-w-0 rounded-md border border-border bg-secondary px-3 py-2" />
        <p className="mt-2 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.savedContext', { context: snapshot.strataContext ?? 65536 })}</p>
        {owned && snapshot.activeContext != null && <p className="mt-1 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.activeContext', { context: snapshot.activeContext })}</p>}
        {dirty && <p className="mt-1 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.pendingContext', { context })}</p>}
        {draft !== undefined && !validContext && <p role="alert" className="mt-1 break-words text-sm text-destructive">{t('endpoints:localEngine.errors.invalidStrataContext')}</p>}
        <p className="mt-1 break-words text-xs text-muted-foreground">{t('endpoints:localEngine.strataContextHint')}</p>
      </div>}
      {chatBusy && <p className="mt-2 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.waiting')}</p>}
      {(error || snapshot?.error) && <p role="alert" className="mt-2 break-words text-sm text-destructive">
        {t(`endpoints:localEngine.errors.${error || snapshot?.error}`, { defaultValue: t('endpoints:localEngine.errors.engineFailed') })}
      </p>}
      <p className="mt-2 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.strataCaution')}</p>
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('endpoints:dstar.restart')}</DialogTitle>
            <DialogDescription>{t('endpoints:dstar.restartConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRestart(false)}>{t('endpoints:dstar.goBack')}</Button>
            <Button disabled={busy || chatBusy || engineTransition || transitioning || !validContext}
              onClick={() => void run('ensure')}>{t('endpoints:dstar.restart')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
