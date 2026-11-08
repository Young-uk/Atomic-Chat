import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localEngineTarget, useLocalEngine } from '@/services/managed-local-engine'

/** Read-only: inspecting the API page must never start or switch an engine. */
export function ServerEngineIdentity() {
  const { t } = useTranslation()
  const state = useLocalEngine()
  const provider = useModelProvider(store => store.getProviderByName(store.selectedProvider))
  const model = useModelProvider(store => store.selectedModel)
  const selected = localEngineTarget(provider, model)
  const matches = selected && state.target?.engine === selected.engine &&
    state.target.provider === selected.provider && state.target.model === selected.model
  // A ready label needs matching native identity AND the requested served model.
  const confirmed = matches && state.phase === 'ready' &&
    state.snapshot?.status === 'ready' && state.snapshot.engine === selected.engine &&
    state.snapshot.servedModels.includes(selected.model)
  const stopped = matches && state.phase === 'idle' && state.snapshot?.status === 'stopped'
  const phase = confirmed ? 'ready' : stopped ? 'idle' :
    matches && state.phase !== 'ready' && state.phase !== 'idle' ? state.phase : null
  return (
    <section aria-label={t('api:overview.chatEngine')} className="mb-5 min-w-0 rounded-xl border border-border p-4 text-sm">
      <p className="min-w-0 break-words text-muted-foreground">{t('api:overview.routeHint')}</p>
      {selected && <div className="mt-3 min-w-0 break-words" role="status">
        <strong>{t('api:overview.chatEngine')}: {selected.engine === 'strata' ? 'Strata' : 'Dstar'}</strong>
        <p>{phase ? t(`endpoints:localEngine.${phase}`, { engine: selected.engine === 'strata' ? 'Strata' : 'Dstar' }) : t('api:overview.engineUnknown')}</p>
      </div>}
      {matches && state.snapshot?.engine && state.snapshot.engine !== selected?.engine &&
        <p className="mt-2 min-w-0 break-words">{t('api:overview.reportedEngine', {
          engine: state.snapshot.engine === 'strata' ? 'Strata' : 'Dstar',
          status: t(`endpoints:dstar.status.${state.snapshot.status}`),
        })}</p>}
    </section>
  )
}
