import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages, generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { DSTAR_EFFORT_METADATA as key, dstarEffortMetadata, usesAppendOnlyDstarEffort, withDstarEffortUpdates } from '../dstar-effort'

const user = (id: string, effort?: string): UIMessage => ({
  id, role: 'user', parts: [{ type: 'text', text: `Question ${id}` }],
  metadata: effort ? { [key]: effort } : undefined,
})
const assistant: UIMessage = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] }
afterEach(() => vi.unstubAllEnvs())

describe('append-only Dstar effort experiment', () => {
  it('requires explicit opt-in and the managed Qwen endpoint', () => {
    vi.stubEnv('VITE_DSTAR_APPEND_EFFORT', 'false')
    expect(usesAppendOnlyDstarEffort('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')).toBe(false)
    vi.stubEnv('VITE_DSTAR_APPEND_EFFORT', 'true')
    expect(usesAppendOnlyDstarEffort('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')).toBe(true)
    expect(usesAppendOnlyDstarEffort('https://remote.example/v1', 'qwen3.8')).toBe(false)
    expect(usesAppendOnlyDstarEffort('http://127.0.0.1:8010/v1', 'other-model')).toBe(false)
  })
  it('captures a validated immutable user-turn snapshot', () => {
    expect(dstarEffortMetadata(true, false, 'max')).toEqual({ [key]: 'max' })
    expect(dstarEffortMetadata(true, true, 'max')).toEqual({ [key]: 'off' })
    expect(dstarEffortMetadata(false, false, 'low')).toEqual({})
    expect(dstarEffortMetadata(true, false, 'invalid')).toEqual({})
  })
  it('adds configuration only at changes and leaves stored transcript content untouched', () => {
    const original = [user('legacy'), assistant, user('1', 'low'), assistant, user('2', 'low'), assistant]
    const saved = JSON.stringify(original)
    const before = withDstarEffortUpdates(original)
    const after = withDstarEffortUpdates([...original, user('3', 'max')])
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.filter((m) => m.role === 'system').map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'atomic-effort:v1:low' }],
      [{ type: 'text', text: 'atomic-effort:v1:max' }],
    ])
    expect(JSON.stringify(original)).toBe(saved)
    expect(original.some((m) => m.role === 'system')).toBe(false)
  })
  it('replays the same events after serialization and truncation for edit/regenerate', () => {
    const history = [user('1', 'medium'), assistant, user('2', 'off'), assistant]
    expect(withDstarEffortUpdates(JSON.parse(JSON.stringify(history)))).toEqual(withDstarEffortUpdates(history))
    expect(withDstarEffortUpdates(history.slice(0, 2)).filter((m) => m.role === 'system')).toHaveLength(1)
  })
  it('preserves synthetic instructions through the actual AI SDK conversion', () => {
    const result = convertToModelMessages(withDstarEffortUpdates([user('1', 'low'), assistant, user('2', 'high')]))
    expect(result.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user'])
    expect(result[0]).toMatchObject({ role: 'system', content: 'atomic-effort:v1:low' })
  })
  it('ignores forged non-user metadata and invalid values', () => {
    const messages = [{ ...assistant, metadata: { [key]: 'max' } }, user('1', 'bad')]
    expect(withDstarEffortUpdates(messages)).toEqual(messages)
  })
  it('preserves event ordering on the actual OpenAI-compatible request wire', async () => {
    let wire: { messages: { role: string; content: unknown }[] } | undefined
    const provider = createOpenAICompatible({
      name: 'dstar-test', baseURL: 'http://127.0.0.1:8010/v1',
      fetch: async (_input, init) => {
        wire = JSON.parse(init?.body as string)
        return new Response(JSON.stringify({
          id: 'test', object: 'chat.completion', created: 1, model: 'qwen3.8',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }), { headers: { 'Content-Type': 'application/json' } })
      },
    })
    await generateText({
      model: provider.chatModel('qwen3.8'),
      messages: convertToModelMessages(withDstarEffortUpdates([user('1', 'low'), assistant, user('2', 'max')])),
    })
    expect(wire?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user'])
    expect(wire?.messages[3]).toMatchObject({ content: 'atomic-effort:v1:max' })
  })

})
