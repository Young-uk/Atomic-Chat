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
