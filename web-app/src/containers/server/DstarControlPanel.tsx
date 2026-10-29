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
  const provider = providers.find((entry) => isDstarEndpoint(entry.base_url))
  const [snapshot, setSnapshot] = useState<DstarSnapshot>()
  const [draft, setDraft] = useState<DstarSelection>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [chatModel, setChatModel] = useState('')
  const alive = useRef(false)
  const synchronized = useRef('')
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
    draft.context <= 524288
  const chatOptions = (provider?.models ?? []).filter((model) =>
    snapshot?.servedModels.includes(model.id)
  )

  const run = async (action: 'start' | 'stop' | 'restart') => {
    if (!draft || busy) return
    setBusy(true)
    setError(undefined)
    setConfirmRestart(false)
    try {
      const next =
        action === 'restart'
          ? await restartDstar(draft)
          : await controlDstar(action, action === 'start' ? draft : undefined)
      if (alive.current) setSnapshot(next)
    } catch (reason) {
      if (alive.current) setError(String(reason))
    } finally {
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
                  disabled={busy || !runnable || !validContext}
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
                busy ||
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
              <input
                className="w-full rounded-md border border-border bg-transparent px-3 py-2"
                type="number"
                min={512}
                max={524288}
                step={512}
                value={draft.context}
                disabled={
                  busy || transitioning || snapshot.status === 'external'
                }
                onChange={(event) =>
                  setDraft({ ...draft, context: Number(event.target.value) })
                }
              />
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
            ? t(`endpoints:dstar.reason.${error}`, { defaultValue: error })
            : snapshot?.error}
        </p>
      )}
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
