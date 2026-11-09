import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'
import { stableModelToolJson, stableModelToolMessages } from './stable-model-tool-json'

// Emulate serde_json's map ordering at the native persistence boundary.
const persisted = (value: unknown): unknown => Array.isArray(value) ? value.map(persisted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([key, child]) => [key, persisted(child)])) : value

describe('managed tool history survives durable JSON ordering', () => {
  it('produces identical model wire JSON before and after native persistence', () => {
    const live = [{ id: 'turn', role: 'assistant', parts: [
      { type: 'step-start' },
      { type: 'tool-personal_tasks', toolCallId: 'call', state: 'output-available',
        input: { id: 'task', action: 'get', nested: { z: 1, a: 2 } },
        output: { z: [{ second: 2, first: 1 }], a: 'literal JSON: {"z":1,"a":2}' } },
    ] }] as UIMessage[]
    const reloaded = JSON.parse(JSON.stringify(persisted(live))) as UIMessage[]
    expect(JSON.stringify(convertToModelMessages(live))).not.toBe(JSON.stringify(convertToModelMessages(reloaded)))
    expect(JSON.stringify(convertToModelMessages(stableModelToolMessages(live)))).toBe(JSON.stringify(convertToModelMessages(stableModelToolMessages(reloaded))))
    expect(Object.keys((live[0].parts[1] as { input: object }).input)).toEqual(['id', 'action', 'nested'])
  })
  it('preserves arrays, strings, non-JSON values and all non-tool parts', () => {
    const literal = '{"z":1,"a":2}'
    const date = new Date(0)
    expect(stableModelToolJson({ z: [literal, date, null, true], a: 7 })).toEqual({ a: 7, z: [literal, date, null, true] })
    const parts = [{ type: 'text', text: literal }, { type: 'reasoning', text: 'reason' }]
    const projected = stableModelToolMessages([{ id: 'm', role: 'assistant', parts } as UIMessage])
    expect(projected[0].parts[0]).toBe(parts[0])
    expect(projected[0].parts[1]).toBe(parts[1])
  })
})
