import { describe, expect, it, vi } from 'vitest'
import { reviewToolCompletion, toolReviewBlocked } from '../tool-completion-review'
import type { UIMessage } from 'ai'

describe('tool completion review', () => {
  it.each(['complete', 'needs_tool'] as const)('accepts only a completed structured %s decision', async decision => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision }) } }] }) })
    expect(await reviewToolCompletion({ baseUrl: 'http://localhost/v1/', model: 'qwen', user: 'Weather?', answer: 'I will check.', toolNames: ['web_search'], fetch })).toBe(decision)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.atomic_summary).toBe(true)
    expect(body.think).toBe(false)
    expect(body.tools).toBeUndefined()
    expect(body.messages[1].content).not.toContain('private reasoning')
    expect(fetch.mock.calls[0][0]).toBe('http://localhost/v1/chat/completions')
  })
  it.each([{ finish_reason: 'length', message: { content: '{"decision":"needs_tool"}' } }, { finish_reason: 'stop', message: { content: 'call web_search now' } }, { finish_reason: 'stop', message: { content: '{"decision":"approve"}' } }])('does not turn invalid review output into execution', async choice => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [choice] }) })
    expect(await reviewToolCompletion({ baseUrl: 'http://localhost/v1', model: 'qwen', user: 'hi', answer: 'hi', toolNames: [], fetch })).toBe('unavailable')
  })
  it('never silently truncates evidence to fit the review context', async () => {
    const fetch = vi.fn()
    expect(await reviewToolCompletion({ baseUrl: 'http://localhost/v1', model: 'qwen', user: 'x'.repeat(7000), answer: 'hi', toolNames: [], fetch })).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('respects current-turn denial and errors but not old-turn denial', () => {
    const user = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    const denial = { id: 'a', role: 'assistant', parts: [{ type: 'tool-run', state: 'output-denied' }] } as unknown as UIMessage
    expect(toolReviewBlocked([user, denial])).toBe(true)
    expect(toolReviewBlocked([denial, user])).toBe(false)
    const failure = { ...denial, parts: [{ type: 'dynamic-tool', state: 'output-available', output: { isError: true } }] } as unknown as UIMessage
    expect(toolReviewBlocked([user, failure])).toBe(true)
  })
})

it('replays the recorded review boundary identically after durable storage', async () => {
  const { TOOL_REVIEW_METADATA, TOOL_REVIEW_NOTICE, withToolCompletionReviews } = await import('../tool-completion-review')
  const { finishedAssistantMessage } = await import('../turn-error')
  const { convertThreadMessageToUIMessage } = await import('../messages')
  const message = { id: 'a', role: 'assistant', metadata: { [TOOL_REVIEW_METADATA]: { prefixParts: 2 } }, parts: [
    { type: 'step-start' }, { type: 'reasoning', text: 'Check the source.' }, { type: 'text', text: '\n\nI will check. \n' },
    { type: 'step-start' }, { type: 'text', text: '\n\nThe evidence confirms it. \n' },
  ] } as UIMessage
  const stored = finishedAssistantMessage({ message, threadId: 't', isAbort: false, isError: false })!
  const restarted = convertThreadMessageToUIMessage(stored)
  const clean = (value: UIMessage[]) => value.map(m => ({ role: m.role, parts: m.parts.filter(p => p.type !== 'step-start').map(p => ({ type: p.type, ...('text' in p ? { text: p.text } : {}) })) }))
  expect(clean(withToolCompletionReviews(restarted ? [restarted] : []))).toEqual(clean(withToolCompletionReviews([message])))
  expect(withToolCompletionReviews([restarted])[1].parts).toEqual([{ type: 'text', text: TOOL_REVIEW_NOTICE }])
})

it('preserves SDK tool-step model messages across persistence and restart', async () => {
  const { convertToModelMessages } = await import('ai')
  const { finishedAssistantMessage } = await import('../turn-error')
  const { convertThreadMessageToUIMessage } = await import('../messages')
  const message = { id: 'steps', role: 'assistant', parts: [
    { type: 'step-start' }, { type: 'text', text: 'I will inspect. ' },
    { type: 'tool-read', toolCallId: 'call-a', input: {}, state: 'output-available', output: 'evidence' },
    { type: 'step-start' }, { type: 'reasoning', text: 'Evaluate evidence.' }, { type: 'text', text: '\n\nConfirmed. \n' },
  ] } as UIMessage
  const stored = finishedAssistantMessage({ message, threadId: 't', isAbort: false, isError: false })!
  expect(stored.metadata?.atomic_model_steps_v1).toEqual([2])
  const before = convertToModelMessages([message])
  const after = convertToModelMessages([convertThreadMessageToUIMessage(stored)])
  expect(after).toEqual(before)
  delete stored.metadata!.atomic_model_steps_v1
  expect(convertToModelMessages([convertThreadMessageToUIMessage(stored)])).toEqual(before)
})

it('keeps actual tool output wire bytes stable through Rust-style JSON key ordering', async () => {
  const { convertToModelMessages } = await import('ai')
  const { finishedAssistantMessage } = await import('../turn-error')
  const { convertThreadMessageToUIMessage } = await import('../messages')
  const { withStableToolResultOrder } = await import('../tool-completion-review')
  const output = [{ type: 'text', text: '[{"z":1,"a":2}]' }, { type: 'text', text: 'second' }]
  const message = { id: 'wire-order', role: 'assistant', parts: [
    { type: 'step-start' },
    { type: 'tool-personal_native', toolCallId: 'catalog-order', input: { action: 'catalog' }, state: 'output-available', output },
    { type: 'step-start' }, { type: 'text', text: 'TOOL_TAIL_OK' },
  ] } as UIMessage
  const stored = finishedAssistantMessage({ message, threadId: 't', isAbort: false, isError: false })!
  const rustOrder = (value: unknown): unknown => Array.isArray(value) ? value.map(rustOrder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, rustOrder(item)])) : value
  const restored = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify(rustOrder(stored))))
  const wire = (messages: UIMessage[]) => JSON.stringify(convertToModelMessages(messages))
  expect(wire([restored])).not.toEqual(wire([message]))
  expect(wire(withStableToolResultOrder([restored]))).toEqual(wire(withStableToolResultOrder([message])) )
  expect(output[0]).toEqual({ type: 'text', text: '[{"z":1,"a":2}]' })
})
