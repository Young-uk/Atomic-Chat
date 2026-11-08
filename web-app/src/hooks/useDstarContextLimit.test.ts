import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelProvider } from './useModelProvider'
import { useDstarContextLimit } from './useDstarContextLimit'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/lib/dstar-context-archive', () => ({ fetchDstarContext: request }))
const select = (model: string, url = 'http://127.0.0.1:8010/v1') => {
  useModelProvider.setState({
    selectedProvider: 'dstar-test',
    selectedModel: { id: model } as Model,
    providers: [
      {
        provider: 'dstar-test',
        base_url: url,
        models: [],
      } as unknown as ModelProvider,
    ],
  })
}
const response = (id: string, context: number) => ({
  ok: true,
  json: async () => ({ data: [{ id, context_length: context }] }),
})

beforeEach(() => {
  request.mockReset()
  select('qwen-a')
})
describe('Dstar runtime context limit', () => {
  it('uses the matching runtime model and hides an old limit after switching models', async () => {
    request.mockResolvedValueOnce(response('qwen-a', 65536))
    const hook = renderHook(() => useDstarContextLimit())
    await waitFor(() => expect(hook.result.current.maxTokens).toBe(65536))
    request.mockRejectedValueOnce(new Error('offline'))
    act(() => select('qwen-b'))
    expect(hook.result.current.maxTokens).toBeUndefined()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(hook.result.current.maxTokens).toBeUndefined()
  })
  it('does not probe other endpoints or reuse an unmatched model limit', async () => {
    select('qwen-a', 'https://example.com/v1')
    const hook = renderHook(() => useDstarContextLimit())
    expect(hook.result.current.isDstar).toBe(false)
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(response('another-model', 65536))
    act(() => select('qwen-a'))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(hook.result.current.maxTokens).toBeUndefined()
  })
})

describe('managed Strata runtime observations', () => {
  it('reports only the selected registered runtime and clears a failed poll', async () => {
    const { STRATA_PROVIDER, STRATA_MODEL } = await import('@/services/managed-local-engine')
    useModelProvider.setState({ selectedProvider: STRATA_PROVIDER, selectedModel: { id: STRATA_MODEL } as Model,
      providers: [{ provider: STRATA_PROVIDER, base_url: 'http://127.0.0.1:18080/v1', models: [{ id: STRATA_MODEL }] } as ModelProvider] })
    request.mockResolvedValue({ ok: true, json: async () => ({ runtime_id: 'epoch-a', atomic_model_fingerprint: 'config-a', data: [{ id: STRATA_MODEL, context_length: 65536 }] }) })
    const hook = renderHook(() => useDstarContextLimit())
    await waitFor(() => expect(hook.result.current.maxTokens).toBe(65536))
    expect(hook.result.current.isStrata).toBe(true)
    expect(hook.result.current.usageScope).toContain('config-a')
    expect(hook.result.current.runtimeScope).toContain('epoch-a')
    request.mockRejectedValue(new Error('offline'))
    // A provider change cannot reuse another provider's observed capacity.
    act(() => select(STRATA_MODEL, 'https://example.com/v1'))
    expect(hook.result.current.maxTokens).toBeUndefined()
    expect(hook.result.current.usageScope).toBeUndefined()
    hook.unmount()
  })
})
