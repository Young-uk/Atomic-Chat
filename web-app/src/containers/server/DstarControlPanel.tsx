import { interruptWorkForEngineStop } from '@/lib/confirmed-engine-stop'
import { ModelContextSlider } from '@/components/ModelContextSlider'
import { MAX_LOCAL_CONTEXT_TOKENS } from '@/lib/local-context-size'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  controlDstar,
  isDstarEndpoint,
  restartDstar,
  type DstarSnapshot,
  type DstarSelection,
} from '@/services/dstar'
import { localEngineCoordinator, localEngineTarget, useLocalEngine } from '@/services/managed-local-engine'
import { isLocalEngineBusy, useLocalEngineBusy } from '@/hooks/useLocalEngineBusy'
import { useEndpointCheckStore } from '@/stores/endpoint-check-store'
import { ServerField, ServerSelect } from './ServerPageParts'

/** A local engine's lifecycle, separate from the app's public API/proxy switch. */
export function DstarControlPanel({
  onAvailabilityChange,
  embedded = false,
}: {
  onAvailabilityChange?: (available: boolean) => void
  embedded?: boolean
} = {}) {
  const supported = IS_MACOS && isPlatformTauri()
  const { t } = useTranslation()
  const hub = useServiceHub()
  const providers = useModelProvider((state) => state.providers)
  const selectModel = useModelProvider((state) => state.selectModelProvider)
  const chatBusy = useLocalEngineBusy()
  const enginePhase = useLocalEngine(state => state.phase)
  const engineTransition = ['loading', 'waiting', 'stopping'].includes(enginePhase)
  const selectedProvider = useModelProvider(store => store.selectedProvider)
  const selectedModel = useModelProvider(store => store.selectedModel)

  const provider = providers.find((entry) => isDstarEndpoint(entry.base_url))
  const [snapshot, setSnapshot] = useState<DstarSnapshot>()
  const [draft, setDraft] = useState<DstarSelection>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmStop, setConfirmStop] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [chatModel, setChatModel] = useState('')
  const alive = useRef(false)
  const synchronized = useRef('')
  const selectOnReady = useRef(false)
  useEffect(() => { selectOnReady.current = false }, [selectedProvider, selectedModel])
  const inAction = useRef(false)
  useEffect(() => {
    onAvailabilityChange?.(snapshot?.available ?? false)
  }, [snapshot?.available, onAvailabilityChange])

  useEffect(() => {
    if (!supported) return
    alive.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await controlDstar('status')
        if (!active) return
        setSnapshot(next)
        setDraft(
          (value) =>
            value ?? {
              ...next.selection,
              model: next.models.some(
                (model) => model.id === next.selection.model && model.available
              )
                ? next.selection.model
                : (next.models.find((model) => model.available)?.id ??
                  next.selection.model),
            }
        )
      } catch (reason) {
        if (active) setError(String(reason))
      } finally {
        if (active) timer = setTimeout(poll, 1000)
      }
    }
    void poll()
    return () => {
      active = false
      alive.current = false
      clearTimeout(timer)
    }
  }, [supported])

  const servedKey = snapshot?.servedModels.join(',')
  const status = snapshot?.status
  useEffect(() => {
    if (!status || !provider) return
    const key = `${provider.provider}:${status}:${servedKey}`
    if (synchronized.current === key) return
    synchronized.current = key
    if (status === 'ready' || status === 'external') {
      // Replace the endpoint card's persisted-looking Connected state with a
      // live check. Preserve credentials, capabilities, and the user's model names.
      void hub
        .providers()
        .checkProviderEndpoint(provider)
        .then((result) => {
          if (synchronized.current === key)
            useEndpointCheckStore
              .getState()
              .setResult(provider.provider, result)
        })
        .catch(() => {})
    } else {
      useEndpointCheckStore.getState().setResult(provider.provider, {
        ok: false,
        latencyMs: 0,
        modelCount: 0,
        message: t(`endpoints:dstar.status.${status}`),
      })
    }
  }, [status, servedKey, provider, hub, t])

  useEffect(() => {
    if (!selectOnReady.current || snapshot?.status !== 'ready' || !snapshot.owned || !provider) return
    const model = provider.models.find(model => snapshot.servedModels.includes(model.id))
    if (model && !isLocalEngineBusy()) {
      selectOnReady.current = false
      const target = localEngineTarget(provider, model)
      if (target) localEngineCoordinator.reconcileReady(target, {
        engine: 'dstar', status: 'ready', owned: snapshot.owned,
        servedModels: snapshot.servedModels, error: snapshot.error,
      })
      selectModel(provider.provider, model.id)
    }
  }, [snapshot, provider, selectModel])

  if (!supported) return null
  const ready = snapshot?.status === 'ready' || snapshot?.status === 'external'
  const transitioning =
    snapshot?.status === 'loading' || snapshot?.status === 'stopping'
  const dirty =
    draft &&
    snapshot &&
    (draft.model !== snapshot.selection.model ||
      draft.context !== snapshot.selection.context)
  const runnable = snapshot?.models.some(
    (model) => model.id === draft?.model && model.available
  )
  const validContext =
    draft &&
    Number.isInteger(draft.context) &&
    draft.context >= 512 &&
    draft.context <= MAX_LOCAL_CONTEXT_TOKENS
  const chatOptions = (provider?.models ?? []).filter((model) =>
    snapshot?.servedModels.includes(model.id)
  )

  const run = async (action: 'start' | 'stop' | 'restart', confirmed = false) => {
    if (!draft || inAction.current || (action !== 'stop' && isLocalEngineBusy()) || (action !== 'stop' && engineTransition)) return
    if (action === 'stop' && !confirmed && isLocalEngineBusy()) { setConfirmStop(true); return }
    inAction.current = true
    selectOnReady.current = action !== 'stop'
    setBusy(true)
    setError(undefined)
    setConfirmRestart(false)
    try {
      if (confirmed) {
        interruptWorkForEngineStop()
        const next = await localEngineCoordinator.stopConfirmed('dstar')
        if (alive.current) setSnapshot({ ...snapshot!, ...next, status: 'stopped', owned: false, servedModels: [], error: next.error ?? undefined })
        setConfirmStop(false)
        return
      }
      if (action !== 'stop') await localEngineCoordinator.prepareStart()
      const coordinatedStop = action === 'stop' && useLocalEngine.getState().target?.engine === 'dstar'
      if (coordinatedStop) {
        localEngineCoordinator.cancel()
        await localEngineCoordinator.settled()
        const state = useLocalEngine.getState()
        if (state.phase === 'error') throw new Error(state.error || 'stopFailed')
      }
      const next =
        action === 'restart'
          ? await restartDstar(draft)
          : await controlDstar(coordinatedStop ? 'status' : action, action === 'start' ? draft : undefined)
      if (alive.current) setSnapshot(next)
    } catch (reason) {
      if (action === 'stop' && !confirmed && String(reason).includes('engineBusy')) setConfirmStop(true)
      selectOnReady.current = false
      if (alive.current) setError(String(reason))
    } finally {
      inAction.current = false
      if (alive.current) setBusy(false)
    }
  }

  return (
    <section
      className={
        embedded
          ? 'min-w-0 pt-4'
          : 'mb-4 min-w-0 rounded-xl border border-border bg-background p-4'
      }
      aria-label={t('endpoints:dstar.title')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{t('endpoints:dstar.title')}</h2>
          <p
            className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            {transitioning && (
              <Loader2
                size={14}
                className="animate-spin shrink-0"
                aria-hidden
              />
            )}
            {snapshot
              ? t(`endpoints:dstar.status.${snapshot.status}`)
              : t('endpoints:dstar.checking')}
            {snapshot?.status === 'loading' &&
              ` · ${t('endpoints:dstar.elapsed', { seconds: snapshot.elapsedSeconds })}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {snapshot?.owned ? (
            <>
              {snapshot.status === 'ready' && dirty && (
                <Button
                  size="sm"
                  disabled={busy || chatBusy || engineTransition || !runnable || !validContext}
                  onClick={() => setConfirmRestart(true)}
                >
                  {t('endpoints:dstar.restart')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || snapshot.status === 'stopping'}
                onClick={() => void run('stop')}
              >
                {t('endpoints:dstar.stop')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={
                busy || chatBusy || engineTransition ||
                !snapshot?.available ||
                snapshot.status === 'external' ||
                !runnable ||
                !validContext
              }
              onClick={() => void run('start')}
            >
              {t('endpoints:dstar.start')}
            </Button>
          )}
        </div>
      </div>
      {chatBusy && <p role="status" className="mt-2 break-words text-sm text-muted-foreground">{t('endpoints:localEngine.waiting')}</p>}
      {snapshot?.owned && (
        <p className="mt-2 break-words text-sm text-muted-foreground">
          {t('endpoints:dstar.activeSettings', {
            model:
              snapshot.models.find(
                (model) => model.id === snapshot.selection.model
              )?.name ?? snapshot.selection.model,
            context: snapshot.selection.context,
          })}
        </p>
      )}
      {snapshot?.available && draft && (
        <>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            <ServerField label={t('endpoints:dstar.model')}>
              <ServerSelect
                className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-left"
                label={t('endpoints:dstar.model')}
                value={draft.model}
                options={snapshot.models
                  .filter((model) => model.available)
                  .map((model) => ({ value: model.id, label: model.name }))}
                disabled={
                  busy || transitioning || snapshot.status === 'external'
                }
                onChange={(model) => setDraft({ ...draft, model })}
              />
            </ServerField>
            <ServerField label={t('endpoints:dstar.context')}>
              <div className="grid min-w-0 grid-cols-[minmax(7rem,0.4fr)_minmax(0,1fr)] items-center gap-3">
              <input
                className="w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-2"
                type="number"
                min={512}
                max={MAX_LOCAL_CONTEXT_TOKENS}
                step={512}
                value={draft.context}
                disabled={
                  busy || transitioning || snapshot.status === 'external'
                }
                onChange={(event) =>
                  setDraft({ ...draft, context: Number(event.target.value) })
                }
              />
              <ModelContextSlider value={draft.context} min={512}
                max={snapshot.models.find(model => model.id === draft.model)?.maxContext}
                disabled={busy || transitioning || snapshot.status === 'external'}
                onChange={context => setDraft({ ...draft, context })} />
              </div>
            </ServerField>
          </div>
          {dirty && snapshot.owned && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('endpoints:dstar.reloadHint')}
            </p>
          )}
          {snapshot.models.some((model) => !model.available) && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t('endpoints:dstar.showUnavailableModels')}
              </summary>
              {snapshot.models
                .filter((model) => !model.available)
                .map((model) => (
                  <p
                    key={model.id}
                    className="mt-2 break-words text-xs text-muted-foreground"
                  >
                    {model.name} ·{' '}
                    {t(
                      `endpoints:dstar.reason.${model.reason ?? 'missingFiles'}`
                    )}
                  </p>
                ))}
            </details>
          )}
          {ready && provider && chatOptions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-0 grow">
                <ServerField label={t('endpoints:dstar.chatModel')}>
                  <ServerSelect
                    className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-left"
                    label={t('endpoints:dstar.chatModel')}
                    value={chatModel || chatOptions[0].id}
                    options={chatOptions.map((model) => ({
                      value: model.id,
                      label: model.displayName || model.name || model.id,
                    }))}
                    onChange={setChatModel}
                  />
                </ServerField>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  selectModel(provider.provider, chatModel || chatOptions[0].id)
                }
              >
                {t('endpoints:dstar.useInChat')}
              </Button>
            </div>
          )}
          {snapshot.status === 'external' && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('endpoints:dstar.externalHint')}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t('endpoints:dstar.lifecycle')}
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">
              {t('endpoints:dstar.logs')}
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
              {snapshot.log || t('endpoints:dstar.noLogs')}
            </pre>
          </details>
        </>
      )}
      {(error || snapshot?.error) && (
        <p
          role="alert"
          className="mt-3 whitespace-pre-wrap break-words text-sm text-destructive"
        >
          {error
            ? t(`endpoints:dstar.reason.${error}`, { defaultValue: t(`endpoints:localEngine.errors.${error}`, { defaultValue: error }) })
            : snapshot?.error}
        </p>
      )}
      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('endpoints:localEngine.confirmStopTitle')}</DialogTitle>
            <DialogDescription>{t('endpoints:localEngine.confirmStopDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmStop(false)}>{t('endpoints:dstar.goBack')}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run('stop', true)}>{t('endpoints:localEngine.confirmStopAction')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('endpoints:dstar.restart')}</DialogTitle>
            <DialogDescription>
              {t('endpoints:dstar.restartConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRestart(false)}>
              {t('endpoints:dstar.goBack')}
            </Button>
            <Button onClick={() => void run('restart')}>
              {t('endpoints:dstar.restart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
