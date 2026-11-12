import { describe, it, expect, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { capturePersonalMemory, withPersonalMemorySnapshots, PERSONAL_MEMORY_METADATA, supportsPersonalMemoryRuntime } from '../personal-memory-context'

const user = (id: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text: id }] })

describe('immutable personal recall', () => {
  it('recognizes managed Strata clones independently of model aliases without enabling arbitrary servers', () => {
    expect(supportsPersonalMemoryRuntime(false, { engine: 'strata', summaryClone: true })).toBe(true)
    expect(supportsPersonalMemoryRuntime(false, { engine: 'strata', summaryClone: false })).toBe(false)
    expect(supportsPersonalMemoryRuntime(false, { engine: 'other', summaryClone: true })).toBe(false)
    expect(supportsPersonalMemoryRuntime(false)).toBe(false)
    expect(supportsPersonalMemoryRuntime(true)).toBe(true)
  })
  it('replays the old evidence unchanged when later memories change', async () => {
    const evidence = await capturePersonalMemory('canary', async () => ({ entries: [{ id: 1, content: 'old fact', sessionId: 'source/1' }] }))
    const a = { ...user('a'), metadata: { [PERSONAL_MEMORY_METADATA]: evidence } }
    const first = withPersonalMemorySnapshots([a], [a])
    const next = withPersonalMemorySnapshots([user('a'), user('b')], [a])
    expect(next[0]).toEqual(first[0])
    expect(next[1]).toEqual(user('b'))
    expect(JSON.stringify(next)).toContain('Historical personal memory evidence')
    expect(a.parts).toEqual(user('a').parts)
  })
  it('does not block on unavailable retrieval or accept unbounded evidence', async () => {
    vi.useFakeTimers()
    const pending = capturePersonalMemory('x', () => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(751)
    expect(await pending).toBe('')
    vi.useRealTimers()
    const long = JSON.parse(await capturePersonalMemory('x', async () => ({ entries: [{ content: 'x'.repeat(5000), sessionId: 'source' }] })))
    expect(long[0].text).toHaveLength(800)
    expect(long[0].excerpt).toBe(true)
    expect(await capturePersonalMemory('x', async () => { throw Error('unavailable') })).toBe('')
  })
})
