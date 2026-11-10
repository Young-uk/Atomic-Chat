import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  compactModelDisplayName,
  modelVariantDetails,
} from '@/lib/model-display-name'
import { getProviderTitle } from '@/lib/utils'
import { useLocalEngine } from '@/services/managed-local-engine'

/**
 * Prefer the verified running managed backend. API routing configuration is
 * the fallback only; reading this identity never starts or switches an engine.
 */
export function useServedModel(running: boolean): {
  live?: boolean
  context?: number
  engine?: string
  /** The id clients pass as `model`, owner and quantization included. */
  model?: string
  /** The model's readable name: its nickname, else the id without owner, format or quant. */
  name?: string
  /** The quantization the id names ("IQ4_XS"), unless the name already reads it. */
  quant?: string
} {
  const defaultModel = useLocalApiServer(
    (state) => state.defaultModelLocalApiServer
  )
  const lastServerModels = useLocalApiServer((state) => state.lastServerModels)
  const local = useLocalEngine()
  const snapshot = local.snapshot
  const live = local.phase === 'ready' && snapshot?.status === 'ready' &&
    snapshot.owned && !snapshot.error && !!snapshot.engine && snapshot.servedModels.length > 0
  const target = local.target?.engine === snapshot?.engine ? local.target : null
  const liveModel = live ? (target && snapshot.servedModels.includes(target.model)
    ? target.model : snapshot.servedModels[0]) : undefined
  const served = liveModel ? { model: liveModel, provider: target?.provider ?? '' }
    : (running ? lastServerModels[0] : undefined) ?? defaultModel
  const nickname = useModelProvider((state) =>
    served
      ? state
          .getProviderByName(served.provider)
          ?.models.find((model) => model.id === served.model)?.displayName
      : undefined
  )
  if (!served) return {}
  const model: Model = { id: served.model, displayName: nickname }
  return {
    live,
    context: live && snapshot.activeContext && snapshot.activeContext > 0 ? snapshot.activeContext : undefined,
    engine: live ? (snapshot.engine === 'strata' ? 'Strata' : 'Dstar') : getProviderTitle(served.provider),
    model: served.model,
    name: compactModelDisplayName(model),
    quant: modelVariantDetails(model).quant,
  }
}
