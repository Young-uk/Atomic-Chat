import { afterEach, expect, it, vi } from 'vitest'
import { newUserThreadContent } from '../completion'
import { convertThreadMessagesToUIMessages } from '../messages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { DSTAR_EFFORT_METADATA, withDstarEffortUpdates } from '../dstar-effort'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('persists a Dstar snapshot separately and replays it after message serialization', () => {
  vi.stubEnv('VITE_DSTAR_APPEND_EFFORT', 'true')
  const state = useModelProvider.getState()
  vi.spyOn(useModelProvider, 'getState').mockReturnValue({
    ...state, selectedProvider: 'dstar-test', selectedModel: { id: 'qwen3.8-flash-next-chat' } as Model,
    getProviderByName: () => ({ base_url: 'http://127.0.0.1:8010/v1' }) as ModelProvider,
  })
  vi.spyOn(useGeneralSetting, 'getState').mockReturnValue({ ...useGeneralSetting.getState(), disableReasoning: false, reasoningBudget: 'max' })
  const stored = newUserThreadContent('thread', 'Visible question', undefined, 'user-1')
  expect(stored.metadata?.[DSTAR_EFFORT_METADATA]).toBe('max')
  expect(stored.content[0].text?.value).toBe('Visible question')
  const restored = convertThreadMessagesToUIMessages(JSON.parse(JSON.stringify([stored])))
  expect(restored).toHaveLength(1)
  expect(restored[0].parts).toEqual([{ type: 'text', text: 'Visible question' }])
  expect(withDstarEffortUpdates(restored).map((m) => m.role)).toEqual(['system', 'user'])
})
