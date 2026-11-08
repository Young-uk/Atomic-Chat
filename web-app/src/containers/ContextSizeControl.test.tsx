import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineManager, type ThreadMessage } from '@janhq/core'

import { publishContextUsage, useInferenceProgress } from '@/lib/inference-progress'
import { ContextSizeControl } from '@/containers/ContextSizeControl'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ModelsService } from '@/services/models/types'
import { seedServiceHub } from '@/test/service-hub'

const stopModel = vi.fn()
const startModel = vi.fn()
const getActiveModels = vi.fn()
const syncActiveModelsFromEngines = vi.fn()
const tokenCountState = vi.hoisted(() => ({ value: 164 }))
const dstarState = vi.hoisted(() => ({
  isDstar: false,
  isStrata: false,
  isManagedLocal: undefined as boolean | undefined,
  providerId: undefined as string | undefined,
  usageScope: undefined as string | undefined,
  runtimeScope: undefined as string | undefined,
  requireUsageScope: undefined as boolean | undefined,
  maxTokens: 65536 as number | undefined,
  modelId: 'qwen-test',
}))
vi.mock('@/hooks/useDstarContextLimit', () => ({
  useDstarContextLimit: () => dstarState,
}))

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver
})

vi.mock('@/hooks/useTokensCount', () => ({
  useTokensCount: () => ({
    tokenCount: tokenCountState.value,
    maxTokens: 16384,
    isNearLimit: false,
    loading: false,
    calculateTokens: vi.fn(),
  }),
}))

vi.mock('@/utils/activeModelsSync', () => ({
  syncActiveModelsFromEngines: (...args: unknown[]) =>
    syncActiveModelsFromEngines(...args),
}))

const fitSetting = (value: boolean) => ({
  key: 'fit',
  title: 'Fit context to device memory',
  description: '',
  controller_type: 'checkbox',
  controller_props: { value },
})

function setSelectedModel(providerName: string, fit?: boolean) {
  const model = {
    id: 'test-model',
    name: 'Test model',
    settings: {
      ctx_len: {
        key: 'ctx_len',
        title: 'Context Size',
        description: 'Size of the prompt context.',
        controller_type: 'input',
        controller_props: {
          type: 'number',
          value: 16384,
          min: 0,
          max: 65536,
          step: 1024,
        },
      },
    },
  } as Model
  const provider = {
    provider: providerName,
    models: [model],
    settings: fit === undefined ? [] : [fitSetting(fit)],
  } as ModelProvider

  useModelProvider.setState({
    providers: [provider],
    selectedProvider: providerName,
    selectedModel: model,
  })
}

describe('ContextSizeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInferenceProgress.setState({ byThread: {}, contextByThread: {} })
    tokenCountState.value = 164
    dstarState.isDstar = false
    dstarState.maxTokens = 65536
    getActiveModels.mockResolvedValue([])
    seedServiceHub({
      models: {
        stopModel,
        startModel,
        getActiveModels,
      } as unknown as ModelsService,
    })
  })

  it.each(['llamacpp', 'llamacpp-upstream', 'mlx'])(
    'is visible for %s models',
    (providerName) => {
      setSelectedModel(providerName)
      render(<ContextSizeControl />)

      expect(
        screen.getByRole('button', { name: 'Context usage: 1.0%' })
      ).toBeInTheDocument()
    }
  )

  it('is hidden for non-local providers', () => {
    setSelectedModel('openai')
    render(<ContextSizeControl />)

    expect(
      screen.queryByRole('button', { name: /Context usage:/ })
    ).not.toBeInTheDocument()
  })

  it('shows the current input and latest output token usage', () => {
    setSelectedModel('llamacpp')
    const messages = [
      {
        role: 'assistant',
        metadata: {
          usage: {
            outputTokens: 24,
          },
        },
      } as ThreadMessage,
    ]
    render(<ContextSizeControl messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 1.0%' }))

    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument()
    expect(screen.getByText('140')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('164 / 16.4K')).toBeInTheDocument()
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass(
      'bg-emerald-500'
    )
    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuemax',
      '524288'
    )
  })

  it('falls back to response usage when a new chat has not been tokenized', () => {
    tokenCountState.value = 0
    setSelectedModel('llamacpp')
    const messages = [
      {
        role: 'assistant',
        metadata: {
          usage: {
            inputTokens: 37,
            outputTokens: 11,
            totalTokens: 48,
          },
        },
      } as ThreadMessage,
    ]
    render(<ContextSizeControl messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 0.3%' }))

    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.getByText('48 / 16.4K')).toBeInTheDocument()
  })

  it.each([
    [12000, 'bg-orange-500'],
    [14700, 'bg-destructive'],
  ])(
    'changes the context progress tone at usage thresholds',
    (additionalTokens, expectedClass) => {
      setSelectedModel('llamacpp')
      render(<ContextSizeControl additionalTokens={additionalTokens} />)

      fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))

      expect(screen.getByRole('progressbar').firstElementChild).toHaveClass(
        expectedClass
      )
    }
  )

  it('persists the edited context size through the model provider store', () => {
    setSelectedModel('llamacpp')
    render(<ContextSizeControl />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 1.0%' }))
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyUp(slider, { key: 'End' })

    expect(
      useModelProvider.getState().selectedModel?.settings?.ctx_len
        ?.controller_props.value
    ).toBe(524288)
  })

  it('uses the model training limit when the engine provides one', async () => {
    const getMaxCtxTrain = vi.fn().mockResolvedValue(131072)
    const engineManager = vi.spyOn(EngineManager, 'instance').mockReturnValue({
      get: () => ({ getMaxCtxTrain }),
    } as unknown as EngineManager)
    setSelectedModel('llamacpp')
    render(<ContextSizeControl />)

    fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))

    await waitFor(() =>
      expect(screen.getByRole('slider')).toHaveAttribute(
        'aria-valuemax',
        '131072'
      )
    )
    expect(getMaxCtxTrain).toHaveBeenCalledWith('test-model')
    engineManager.mockRestore()
  })

  it('restarts a running model after the context size changes', async () => {
    vi.useFakeTimers()
    getActiveModels.mockResolvedValue(['test-model'])
    setSelectedModel('mlx')
    render(<ContextSizeControl />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 1.0%' }))
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyUp(slider, { key: 'End' })

    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(stopModel).toHaveBeenCalledWith('test-model')
    expect(startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mlx' }),
      'test-model',
      true
    )
    expect(syncActiveModelsFromEngines).toHaveBeenCalled()
    vi.useRealTimers()
  })

  describe('fit to device memory', () => {
    it('shows the fit switch for a llama.cpp engine and disables the slider while it is on', () => {
      // Under fit the slider used to be ignored silently (`--ctx-size` is
      // not emitted); now it says so by being disabled.
      setSelectedModel('llamacpp-upstream', true)
      render(<ContextSizeControl />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Context usage: 1.0%' })
      )

      expect(
        screen.getByRole('switch', { name: 'assistants:contextSizeFit' })
      ).toBeChecked()
      expect(screen.getByRole('slider')).toHaveAttribute('data-disabled')
    })

    it('hands the slider back when fit is switched off', async () => {
      const updateSettings = vi.fn().mockResolvedValue(undefined)
      seedServiceHub({
        models: {
          stopModel,
          startModel,
          getActiveModels,
        } as unknown as ModelsService,
        providers: {
          updateSettings,
        } as unknown as Parameters<typeof seedServiceHub>[0]['providers'],
      })
      setSelectedModel('llamacpp-upstream', true)
      render(<ContextSizeControl />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Context usage: 1.0%' })
      )

      fireEvent.click(
        screen.getByRole('switch', { name: 'assistants:contextSizeFit' })
      )

      await waitFor(() =>
        expect(screen.getByRole('slider')).not.toHaveAttribute('data-disabled')
      )
      expect(updateSettings).toHaveBeenCalledWith(
        'llamacpp-upstream',
        expect.arrayContaining([
          expect.objectContaining({
            key: 'fit',
            controller_props: expect.objectContaining({ value: false }),
          }),
        ])
      )
    })

    it('offers no fit switch for an engine without the flag', () => {
      setSelectedModel('mlx')
      render(<ContextSizeControl />)
      fireEvent.click(
        screen.getByRole('button', { name: 'Context usage: 1.0%' })
      )

      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.getByRole('slider')).not.toHaveAttribute('data-disabled')
    })
  })
})

describe('Dstar context usage', () => {
  beforeEach(() => {
    dstarState.maxTokens = 65536
    seedServiceHub({
      models: {
        stopModel,
        startModel,
        getActiveModels,
      } as unknown as ModelsService,
    })
  })
  it('shows reported request usage for Dstar without a local context slider', () => {
    setSelectedModel('custom-dstar')
    dstarState.isDstar = true
    const messages = [
      {
        role: 'assistant',
        metadata: {
          modelId: 'qwen-test',
          usage: { inputTokens: 48000, outputTokens: 1152, totalTokens: 49152 },
        },
      },
    ] as ThreadMessage[]
    render(<ContextSizeControl messages={messages} />)
    const trigger = screen.getByRole('button', { name: 'Context usage: 75.0%' })
    expect(trigger.title).toContain('49.2K / 65.5K tokens')
    fireEvent.click(trigger)
    expect(
      screen.getByText(/Last reported request, including/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('does not present another model usage or an unknown limit as a measured percentage', () => {
    setSelectedModel('custom-dstar')
    dstarState.isDstar = true
    const messages = [
      {
        role: 'assistant',
        metadata: { modelId: 'another-model', usage: { totalTokens: 60000 } },
      },
    ] as ThreadMessage[]
    const view = render(<ContextSizeControl messages={messages} />)
    expect(
      screen.getByRole('button', { name: 'Context usage: —' })
    ).toBeInTheDocument()
    dstarState.maxTokens = undefined
    view.rerender(<ContextSizeControl messages={messages} />)
    expect(
      screen.getByRole('button', { name: 'Context usage: —' })
    ).toBeInTheDocument()
  })
  it('uses the full live prompt including cached tokens and refreshes after a summary', () => {
    setSelectedModel('custom-dstar')
    dstarState.isDstar = true
    useInferenceProgress.setState({ byThread: { live: {
      requestId: 'new', startedAt: 0, phase: 'reading', total: 8192, cache: 32768,
    } }, contextByThread: {} })
    const view = render(<ContextSizeControl threadId="live" />)
    expect(screen.getByRole('button', { name: 'Context usage: 62.5%' }).title).toContain('Current request input')
    act(() => {
      useInferenceProgress.setState({ byThread: {} })
      publishContextUsage('live', { tokens: 16384, estimated: true, modelId: 'qwen-test' })
    })
    view.rerender(<ContextSizeControl threadId="live" />)
    expect(screen.getByRole('button', { name: 'Context usage: 25.0%' }).title).toContain('Estimated next request')
    view.rerender(<ContextSizeControl threadId="other" />)
    expect(screen.getByRole('button', { name: 'Context usage: —' })).toBeInTheDocument()
  })

  it('uses last-step context rather than cumulative multi-tool billing usage after reload', () => {
    setSelectedModel('custom-dstar')
    dstarState.isDstar = true
    const messages = [
      { role: 'assistant', metadata: { modelId: 'qwen-test',
        usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 0 },
      } },
      { role: 'assistant', metadata: { modelId: 'qwen-test',
        usage: { inputTokens: 1000, outputTokens: 10 },
      } },
      { role: 'assistant', metadata: { modelId: 'another-model',
        usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 1000 },
      } },
      { role: 'assistant', metadata: { modelId: 'qwen-test',
      usage: { inputTokens: 120000, outputTokens: 512, totalTokens: 120512 },
      contextUsage: { inputTokens: 32256, outputTokens: 512, totalTokens: 32768, cachedInputTokens: 16128 },
    } }] as ThreadMessage[]
    render(<ContextSizeControl messages={messages} />)
    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 50.0%' }))
    expect(screen.getByText('Average cache hit rate in this chat')).toBeInTheDocument()
    expect(screen.getByText('25.0%')).toBeInTheDocument()
    expect(screen.getByText('Last request cache hit rate')).toBeInTheDocument()
    expect(screen.getByText(/^50\.0% \(16\.1K \/ 32\.3K\)$/)).toBeInTheDocument()
  })

})


describe('Strata scoped cache usage', () => {
  beforeEach(() => {
    seedServiceHub({ models: { stopModel, startModel, getActiveModels } as unknown as ModelsService })
    useInferenceProgress.setState({ byThread: {}, contextByThread: {} })
    setSelectedModel('custom-strata')
    Object.assign(dstarState, { isDstar: false, isStrata: true, isManagedLocal: true,
      providerId: 'custom-strata', modelId: 'qwen-test', usageScope: 'config-a', runtimeScope: 'runtime-a', requireUsageScope: true, maxTokens: 65536 })
  })
  const message = (input: unknown, cached: unknown, overrides = {}) => ({ role: 'assistant', metadata: {
    modelId: 'qwen-test', providerId: 'custom-strata', contextUsageScope: 'config-a', finishReason: 'stop',
    usage: { inputTokens: 999999, outputTokens: 100, totalTokens: 999999 },
    contextUsage: { inputTokens: input, cachedInputTokens: cached, outputTokens: 10 }, ...overrides,
  } }) as ThreadMessage
  const open = (messages: ThreadMessage[]) => {
    render(<ContextSizeControl messages={messages} threadId="strata" />)
    fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))
  }
  it('shows final request ratio and arithmetic mean, including a measured zero', () => {
    open([message(100, 0), message(1000, 1000), message(10000, 5000)])
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('50.0% (5.0K / 10.0K)')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
  it.each([undefined, -1, 1001, 1.5, NaN, '500'])('omits unknown or invalid cache count %s', cached => {
    open([message(1000, cached)])
    expect(screen.queryByText('Last request cache hit rate')).not.toBeInTheDocument()
    expect(screen.queryByText('Average cache hit rate in this chat')).not.toBeInTheDocument()
  })
  it('does not infer a cache ratio from missing or invalid input count', () => {
    open([message(undefined, 0), message(-1, 0), message(0, 0), message(1.5, 1)])
    expect(screen.queryByText('Average cache hit rate in this chat')).not.toBeInTheDocument()
  })
  it('ignores old, cancelled, other provider/model/runtime measurements and unscoped live occupancy', () => {
    useInferenceProgress.setState({ byThread: { strata: { requestId: 'old', startedAt: 0, phase: 'reading', total: 50000 } },
      contextByThread: { strata: { tokens: 50000, modelId: 'qwen-test', estimated: false } } })
    open([message(100, 100, { contextUsageScope: undefined }), message(100, 100, { finishReason: 'abort' }),
      message(100, 100, { modelId: 'other' }), message(100, 100, { providerId: 'other' }),
      message(100, 100, { contextUsageScope: 'config-b' })])
    expect(screen.getByRole('button', { name: 'Context usage: —' })).toBeInTheDocument()
    expect(screen.queryByText('Last request cache hit rate')).not.toBeInTheDocument()
  })
  it('keeps historical ratios after restart but rejects old live occupancy', () => {
    useInferenceProgress.setState({ byThread: { strata: { requestId: 'old', startedAt: 0, phase: 'reading', total: 50000,
      usageScope: 'config-a', runtimeScope: 'old-runtime' } }, contextByThread: { strata: {
      tokens: 50000, estimated: false, modelId: 'qwen-test', usageScope: 'config-a', runtimeScope: 'old-runtime',
    } } })
    open([message(1000, 500)])
    expect(screen.getByText('50.0% (500 / 1.0K)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Context usage: 1.5%' }).title).toContain('Last reported request')
  })
  it('hides measurements when the identity probe fails', () => {
    const view = render(<ContextSizeControl messages={[message(1000, 500)]} />)
    expect(screen.getByRole('button', { name: /1.5%/ })).toBeInTheDocument()
    dstarState.usageScope = undefined
    dstarState.maxTokens = undefined
    view.rerender(<ContextSizeControl messages={[message(1000, 500)]} />)
    expect(screen.getByRole('button', { name: 'Context usage: —' })).toBeInTheDocument()
  })
})

describe('verified Dstar cache identity', () => {
  beforeEach(() => {
    seedServiceHub({ models: { stopModel, startModel, getActiveModels } as unknown as ModelsService })
    useInferenceProgress.setState({ byThread: {}, contextByThread: {} })
    setSelectedModel('custom-dstar')
    Object.assign(dstarState, { isDstar: true, isStrata: false, isManagedLocal: true,
      modelId: 'qwen-test', providerId: 'custom-dstar', usageScope: 'verified-iq3', runtimeScope: undefined,
      requireUsageScope: true, maxTokens: 65536 })
  })
  const measured = (scope?: string) => ({ role: 'assistant', metadata: {
    modelId: 'qwen-test', providerId: 'custom-dstar', contextUsageScope: scope,
    usage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: 1000 },
    contextUsage: { inputTokens: 1000, outputTokens: 10, cachedInputTokens: scope === 'verified-iq3' ? 0 : 1000 },
  } }) as ThreadMessage
  it('does not mix legacy or another quant with new verified IQ3 ratios', () => {
    render(<ContextSizeControl messages={[measured(), measured('legacy-dstar'), measured('verified-iq2'), measured('verified-iq3')]} />)
    fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))
    expect(screen.getByText('0.0%')).toBeInTheDocument()
    expect(screen.getByText('0.0% (0 / 1.0K)')).toBeInTheDocument()
  })
  it('keeps verified IQ3 measurements out of an ambiguous legacy display', () => {
    dstarState.requireUsageScope = false
    dstarState.usageScope = 'legacy-dstar'
    render(<ContextSizeControl messages={[measured(), measured('verified-iq3')]} />)
    fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    expect(screen.getByText('100.0% (1.0K / 1.0K)')).toBeInTheDocument()
  })
})
