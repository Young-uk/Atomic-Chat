import { useEffect, useState } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { localCapabilityTarget, probeLocalModelCapabilities, type LocalModelCapabilities } from '@/services/local-model-capabilities'

/** Retain the public hook name; both managed engines report their actual limit. */
export function useDstarContextLimit() {
  const model = useModelProvider(state => state.selectedModel)
  const provider = useModelProvider(state => state.providers.find(entry => entry.provider === state.selectedProvider))
  const target = localCapabilityTarget(provider, model)
  const key = JSON.stringify([provider?.provider, provider?.base_url, model?.id, target?.engine])
  const [observation, setObservation] = useState<{ key: string; value: LocalModelCapabilities }>()
  useEffect(() => {
    if (!target || !provider || !model) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const abort = new AbortController()
    const poll = async () => {
      const value = await probeLocalModelCapabilities(provider, model, { signal: abort.signal })
      if (active) {
        setObservation(value ? { key, value } : undefined)
        timer = setTimeout(poll, 5000)
      }
    }
    void poll()
    return () => { active = false; abort.abort(); clearTimeout(timer) }
    // The identity key captures the selected service/model, not store object churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const value = observation?.key === key ? observation.value : undefined
  return {
    isDstar: target?.engine === 'dstar',
    isStrata: target?.engine === 'strata',
    isManagedLocal: Boolean(target),
    modelId: model?.id,
    providerId: provider?.provider,
    usageScope: value?.usageScope,
    runtimeScope: value?.runtimeScope,
    requireUsageScope: Boolean(target) && (!value || target?.engine === 'strata' || Boolean(value.archiveScope)),
    maxTokens: value?.contextLength,
  }
}
