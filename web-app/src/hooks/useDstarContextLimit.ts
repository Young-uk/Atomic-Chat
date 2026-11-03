import { useEffect, useState } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { fetchDstarContext } from '@/lib/dstar-context-archive'
import { isDstarEndpoint } from '@/services/dstar'

/** Read the running endpoint's limit; never infer it from an unloaded model. */
export function useDstarContextLimit() {
  const modelId = useModelProvider((state) => state.selectedModel?.id)
  const baseUrl = useModelProvider(
    (state) =>
      state.providers.find(
        (provider) => provider.provider === state.selectedProvider
      )?.base_url
  )
  const [limit, setLimit] = useState<{ key: string; value: number }>()
  const isDstar = isDstarEndpoint(baseUrl)
  const key = `${baseUrl}/${modelId}`
  useEffect(() => {
    if (!isDstar || !modelId) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const abort = new AbortController()
    const poll = async () => {
      try {
        const response = await fetchDstarContext(
          `${baseUrl?.replace(/\/$/, '')}/models`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
          }
        )
        const body = await response.json()
        const value = body.data?.find(
          (model: { id: string }) => model.id === modelId
        )?.context_length
        if (active)
          setLimit(
            response.ok && Number.isSafeInteger(value) && value > 0
              ? { key, value }
              : undefined
          )
      } catch {
        if (active) setLimit(undefined)
      } finally {
        if (active) timer = setTimeout(poll, 5000)
      }
    }
    void poll()
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [baseUrl, isDstar, key, modelId])
  return {
    isDstar,
    modelId,
    maxTokens: limit?.key === key ? limit.value : undefined,
  }
}
