import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { captureBackgroundReviewEvidence } from './background-review-evidence'
describe('background review evidence', () => {
  it('excludes thinking, announcements and failed tool results', () => {
    const messages = [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Always verify the result.' }] }, { id: 'assistant', role: 'assistant', parts: [
      { type: 'reasoning', text: 'Private thought' }, { type: 'data-announcement', data: 'Working' },
      { type: 'dynamic-tool', toolName: 'test', toolCallId: 'ok', state: 'output-available', input: {}, output: { exitCode: 0, stdout: 'passed' } },
      ...[{ isError: true }, { exitCode: 1 }, { content: [{ type: 'text', text: 'Error: unavailable' }] }, undefined].map((output, i) => ({ type: 'dynamic-tool', toolCallId: `bad${i}`, state: 'output-available', output })),
      { type: 'text', text: 'Done.' },
    ] }] as unknown as UIMessage[]
    const rows = captureBackgroundReviewEvidence(messages)
    expect(rows.filter(row => row.role === 'tool')).toHaveLength(1)
    expect(rows.find(row => row.id === 'tool:ok')?.verified).toBe(true)
    expect(JSON.stringify(rows)).not.toMatch(/Private thought|Working|bad0/)
  })
  it('bounds evidence without truncating individual sources inconsistently', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: 'user', parts: [{ type: 'text', text: 'x'.repeat(4000) }] })) as UIMessage[]
    const rows = captureBackgroundReviewEvidence(messages)
    expect(rows.length).toBeLessThanOrEqual(24)
    expect(rows.reduce((n, row) => n + row.text.length, 0)).toBeLessThanOrEqual(12000)
    expect(rows.at(-1)?.id).toBe('m29')
  })
})

it('deduplicates continued messages and tool calls, keeps user evidence, and rejects array-wrapped tool errors', () => {
  const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Always check the result.' }] }
  const assistant = { id: 'a', role: 'assistant', parts: [
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'dynamic-tool', toolCallId: `ok${i}`, toolName: 'test', state: 'output-available', output: [{ type: 'text', text: 'x'.repeat(3000) }, { type: 'image', data: 'PRIVATE_IMAGE_CANARY' }] })),
    { type: 'dynamic-tool', toolCallId: 'bad-array', state: 'output-available', output: [{ type: 'text', text: '{"error":"failed"}' }] },
    { type: 'text', text: 'Done.' },
  ] } as unknown as UIMessage
  const rows = captureBackgroundReviewEvidence([user, assistant, assistant])
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  expect(rows.some(row => row.id === 'u')).toBe(true)
  expect(rows.some(row => row.id === 'tool:bad-array')).toBe(false)
  expect(JSON.stringify(rows)).not.toContain('PRIVATE_IMAGE_CANARY')
})
