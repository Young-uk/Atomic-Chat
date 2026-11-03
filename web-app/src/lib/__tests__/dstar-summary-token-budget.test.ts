import { afterEach, expect, it, vi } from 'vitest'
import { summarizeWithDstar } from '../dstar-context-archive'

afterEach(() => vi.unstubAllGlobals())
const count = (body: { messages: { content: string }[] }) => 64 + Math.ceil(body.messages.reduce((n, m) => n + m.content.length, 0) / 2)

it('uses the rendered token budget instead of the 2400-character cap and preserves all evidence', async () => {
  const generated: any[] = []
  const counted: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/atomic/summary-token-count')) {
      counted.push(body)
      return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    }
    generated.push(body)
    expect(count(body)).toBeLessThanOrEqual(13312)
    expect(body.max_tokens).toBe(2048)
    expect(count(body) + body.max_tokens + 1024).toBeLessThanOrEqual(16384)
    expect(body.atomic_summary).toBe(true)
    expect(body.think).toBe(false)
    expect(body.tools).toBeUndefined()
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Verified handoff' } }] }) }
  }))
  const evidence = '한글😀'.repeat(14000)
  await summarizeWithDstar('http://localhost/v1', 'model', { tokenCounting: true })('', evidence, new AbortController().signal)
  expect(generated.length).toBeGreaterThan(1)
  expect(generated.length).toBeLessThan(6)
  const pieces = generated.map(b => JSON.parse(b.messages[1].content).newEvidence)
  expect(Array.from(pieces[0]).length).toBeGreaterThan(2400)
  expect(pieces.join('')).toBe(evidence)
  expect(counted.every(b => b.model === 'model' && b.atomic_summary && b.think === false)).toBe(true)
})

it.each([{ input_tokens: -1, context_length: 16384 }, { input_tokens: 100, context_length: 8192 }, { input_tokens: 1.5, context_length: 16384 }])('does not generate from an invalid or old-server token count', async result => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => result }))
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })('', 'evidence', new AbortController().signal)).rejects.toThrow('incompatible budget')
  expect(fetcher.mock.calls).toHaveLength(1)
})

it('never sends inference when even an empty evidence envelope exceeds the budget', async () => {
  const fetcher = vi.fn(async (_url: unknown) => ({ ok: true, json: async () => ({ input_tokens: 14000, context_length: 16384 }) }))
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })('', 'text', new AbortController().signal)).rejects.toThrow('bounded evidence budget')
  expect(fetcher.mock.calls.every(call => String(call[0]).endsWith('/summary-token-count'))).toBe(true)
})

it('resumes a saved checkpoint using the same evidence and summary semantics', async () => {
  const saved: any[] = []
  let fail = true
  const offsets: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/summary-token-count')) return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    const fragment = JSON.parse(body.messages[1].content)
    offsets.push(fragment.evidenceOffset)
    if (fragment.evidenceOffset && fail) throw new Error('interrupted')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Verified handoff' } }] }) }
  }))
  const evidence = '한글😀'.repeat(14000)
  const run = summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })
  await expect(run('', evidence, new AbortController().signal, undefined, { save: async c => { saved.push(structuredClone(c)) } })).rejects.toThrow('interrupted')
  const checkpoint = saved.at(-1)
  expect(checkpoint.offset).toBeGreaterThan(2400)
  fail = false; offsets.length = 0
  await run('', evidence, new AbortController().signal, undefined, { resume: checkpoint, save: async () => {} })
  expect(offsets[0]).toBe(checkpoint.offset)
})

it('retains verified unresolved work with token-sized evidence', async () => {
  const saved: any[] = []
  const source = [{ id: 'user-keep', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Remember the pending report.' }] }]
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/summary-token-count')) return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'The report is pending.', openRequests: [{ id: 'user-keep', request: 'Remember the pending report.' }], resolvedRequests: [] }) } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })('', 'new historical evidence'.repeat(2000), new AbortController().signal, undefined, { requestSources: source, save: async c => { saved.push(c) } })
  expect(saved.at(-1).requests.open).toHaveLength(1)
  expect(saved.at(-1).requests.open[0].id).toBe('user-keep')
})

it('reserves source-repair instructions before filling the fragment and keeps repairs identical', async () => {
  const sources = Array.from({ length: 100 }, (_, i) => ({ id: `user-${String(i).padStart(4, '0')}-${'x'.repeat(30)}`, role: 'user' as const,
    parts: [{ type: 'text' as const, text: 'Keep the requested report pending.' }] }))
  const originals: string[] = []
  let pendingFragment = ''
  let repaired = 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/summary-token-count')) return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    expect(count(body)).toBeLessThanOrEqual(13312)
    expect(body.think).toBe(false)
    const repair = body.messages[0].content.startsWith('Repair attempt')
    if (repair) {
      expect(body.messages[1].content).toBe(pendingFragment)
      repaired++
    } else {
      pendingFragment = body.messages[1].content
      originals.push(JSON.parse(pendingFragment).newEvidence)
    }
    const content = JSON.stringify({ summary: 'Verified handoff.', openRequests: repair ? [] : [{ id: 'not-a-user', request: 'Pending report' }], resolvedRequests: [] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  const evidence = 'historical evidence '.repeat(3000)
  await summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })('', evidence, new AbortController().signal, undefined, { requestSources: sources, save: async () => {} })
  expect(repaired).toBeGreaterThan(0)
  expect(originals.join('')).toBe(evidence)
})

it('recompresses a completed oversized repack instead of repeating the original input', async () => {
  const original = 'Original history '.repeat(300)
  const oversized = '한'.repeat(950)
  const repacks: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/summary-token-count')) return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    expect(body.think).toBe(false)
    const input = JSON.parse(body.messages[1].content)
    if ('historicalHandoff' in input) repacks.push(input.historicalHandoff)
    const content = 'historicalHandoff' in input && repacks.length === 1 ? oversized : 'Compact verified handoff'
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  const result = await summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })(original, 'New evidence', new AbortController().signal)
  expect(repacks).toEqual([original, oversized])
  expect(result).toBe('Compact verified handoff')
})

it('does not reuse truncated repacks or commit failed repack checkpoints', async () => {
  const original = 'Original history '.repeat(300)
  const inputs: string[] = []
  const save = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (String(url).endsWith('/summary-token-count')) return { ok: true, json: async () => ({ input_tokens: count(body), context_length: 16384 }) }
    inputs.push(JSON.parse(body.messages[1].content).historicalHandoff)
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete handoff' } }] }) }
  }))
  await expect(summarizeWithDstar('http://localhost/v1', 'm', { tokenCounting: true })(original, 'New evidence', new AbortController().signal, undefined, { save })).rejects.toThrow('bounded output budget')
  expect(inputs).toEqual([original, original, original])
  expect(save).not.toHaveBeenCalled()
})
