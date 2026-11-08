import { IconCircleCheck, IconCircleX, IconLoader2 } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalEngineBusy } from '@/hooks/useLocalEngineBusy'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localEngineCoordinator, localEngineTarget, useLocalEngine } from '@/services/managed-local-engine'

/** The existing model picker is also the engine picker; no second selection. */
export function LocalEngineStatus({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const state = useLocalEngine()
  const busy = useLocalEngineBusy()
  const provider = useModelProvider(store => store.getProviderByName(store.selectedProvider))
  const model = useModelProvider(store => store.selectedModel)
  const selected = localEngineTarget(provider, model)
  if (!selected || state.target?.engine !== selected.engine || state.target.provider !== selected.provider || state.target.model !== selected.model || !IS_TAURI || IS_IOS || IS_ANDROID) return null
  const loading = state.phase === 'loading' || state.phase === 'waiting' || state.phase === 'stopping'
  const label = t(`endpoints:localEngine.${state.phase}`, { engine: selected.engine === 'strata' ? 'Strata' : 'Dstar' })
  const icon = loading ? <IconLoader2 size={14} className="animate-spin" /> :
    state.phase === 'ready' ? <IconCircleCheck size={14} /> :
    state.phase === 'error' ? <IconCircleX size={14} /> :
    <span className="size-2 rounded-full border border-current" />
  if (compact) return <span role="status" aria-label={label} title={label} className="ml-1.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
  return (
    <section aria-label={t('endpoints:localEngine.title')} className="mt-2 min-w-0 border-t pt-3 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>{icon}</span>
          <span className="min-w-0 break-words">{label}</span>
        </div>
        <div className="flex w-16 shrink-0 justify-end">
          {loading ? <Button size="sm" variant="ghost" disabled={state.phase === 'waiting' || state.phase === 'stopping' || busy} onClick={() => localEngineCoordinator.cancel()}>{t('endpoints:dialog.cancel')}</Button> :
            state.phase === 'ready' ? <Button size="sm" variant="ghost" disabled={busy} title={busy ? t('endpoints:localEngine.waiting') : undefined} onClick={() => localEngineCoordinator.cancel()}>{t('endpoints:localEngine.stop')}</Button> : <Button size="sm" variant="ghost" disabled={busy} title={busy ? t('endpoints:localEngine.waiting') : undefined} onClick={() => localEngineCoordinator.startSelected(selected)}>{t('endpoints:localEngine.retry')}</Button>}
        </div>
      </div>
      {state.phase === 'loading' && <p className="mt-1 truncate tabular-nums text-muted-foreground">{t('endpoints:dstar.elapsed', { seconds: state.snapshot?.elapsedSeconds ?? 0 })}</p>}
      {state.error && <p role="alert" className="mt-2 break-words text-destructive">{t(`endpoints:localEngine.errors.${state.error}`, { defaultValue: t('endpoints:localEngine.errors.engineFailed') })}</p>}
      {selected.engine === 'strata' && <p className="mt-2 break-words text-muted-foreground">{t('endpoints:localEngine.strataCaution')}</p>}
    </section>
  )
}
