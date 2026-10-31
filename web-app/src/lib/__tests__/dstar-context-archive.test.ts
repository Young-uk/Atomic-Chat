import { expect, it, vi, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { archiveStore, searchConversationArchive, summarizeWithDstar } from '../dstar-context-archive'
import type { ArchiveRecord } from '../dstar-context-compaction'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const record: ArchiveRecord = { version: 1, id: 'unique', threadId: 'thread', previousSummary: '', source: [
  { id: 'user', role: 'user', metadata: { message_clock: { date: '2026-10-30', time: '02:00:00' } }, parts: [{ type: 'text', text: 'The confirmed project is Maple.' }] },
  { id: 'answer', role: 'assistant', metadata: { message_clock: { date: '2026-10-30', time: '03:00:00' } }, parts: [{ type: 'reasoning', text: 'SECRET speculative Maple thought' }, { type: 'text', text: 'Maple confirmed.' }] },
] }
it('uses original time ranges and unique archive names without altering source', async () => {
  vi.mocked(invoke).mockResolvedValue([])
  await archiveStore().save(record)
  const args = vi.mocked(invoke).mock.calls[0][1] as { name: string; data: string }
  expect(args.name).toBe('2026-10-30-02-00-00~2026-10-30-03-00-00_unique.json')
  expect(JSON.parse(args.data).source).toEqual(record.source)
})
it('searches only the requested thread, deduplicates and excludes private reasoning', async () => {
  vi.mocked(invoke).mockResolvedValue([JSON.stringify(record), JSON.stringify(record), JSON.stringify({ ...record, threadId: 'another' })])
  const hits = await searchConversationArchive('thread', 'Maple')
  expect(hits).toHaveLength(2)
  expect(JSON.stringify(hits)).not.toContain('SECRET')
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('context_archive', { threadId: 'thread', name: null, data: null })
})
it('routes summary inference to its own slot and rejects truncated output', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'partial summary' } }] }) })
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://127.0.0.1:8010/v1', 'model')('', 'evidence', new AbortController().signal)).rejects.toThrow('did not complete')
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.atomic_summary).toBe(true)
  expect(body.think).toBe(false)
  expect(body.tools).toBeUndefined()
})
it('merges bounded fragments sequentially and publishes only the complete summary', async () => {
  const bodies: { messages: { content: string }[] }[] = []
  const fetcher = vi.fn().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: `summary-${bodies.length}` } }] }) }
  })
  vi.stubGlobal('fetch', fetcher)
  const evidence = '한글😀\\"'.repeat(3000)
  const result = await summarizeWithDstar('http://localhost/v1', 'model')('original', evidence, new AbortController().signal)
  expect(bodies.length).toBeGreaterThan(2)
  expect(result).toBe(`summary-${bodies.length}`)
  let reconstructed = ''
  for (const [index, body] of bodies.entries()) {
    expect(body.messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0)).toBeLessThanOrEqual(6000)
    const fragment = JSON.parse(body.messages[1].content)
    expect(fragment.previousSummary).toBe(index ? `summary-${index}` : 'original')
    reconstructed += fragment.newEvidence
  }
  expect(reconstructed).toBe(evidence)
})
it('does not return an intermediate summary after cancellation', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    controller.abort()
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'partial' } }] }) }
  }))
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', 'x'.repeat(10000), controller.signal)).rejects.toThrow()
})
it('repacks oversized previous memory before merging instead of rejecting it', async () => {
  const bodies: { messages: { content: string }[]; max_tokens: number }[] = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: body.messages[0].content.startsWith('Condense') ? 'Compact confirmed facts' : 'Final handoff' } }] }) }
  }))
  expect(await summarizeWithDstar('http://localhost/v1', 'model')('x'.repeat(7000), '', new AbortController().signal)).toBe('Final handoff')
  expect(bodies.some(b => b.messages[0].content.startsWith('Condense'))).toBe(true)
  for (const body of bodies) {
    const bound = body.messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0)
    expect(bound).toBeLessThanOrEqual(6000)
    expect(bound + body.max_tokens + 512).toBeLessThanOrEqual(8192)
  }
})
it('retries only the truncated fragment against the last complete summary without losing evidence', async () => {
  const bodies: { messages: { content: string }[] }[] = []
  const evidence = '한글😀'.repeat(1500)
  const fetcher = vi.fn().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    const failed = bodies.length === 2
    return { ok: true, json: async () => ({ choices: [{ finish_reason: failed ? 'length' : 'stop', message: { content: failed ? 'TRUNCATED_UNSAFE' : `safe-${bodies.length}` } }] }) }
  })
  vi.stubGlobal('fetch', fetcher)
  await summarizeWithDstar('http://localhost/v1', 'model')('prior', evidence, new AbortController().signal)
  const failed = JSON.parse(bodies[1].messages[1].content)
  const retry = JSON.parse(bodies[2].messages[1].content)
  expect(retry.previousSummary).toBe('safe-1')
  expect(retry.evidenceOffset).toBe(failed.evidenceOffset)
  expect(Array.from(retry.newEvidence).length).toBeLessThan(Array.from(failed.newEvidence).length)
  expect(bodies[2].messages[0].content).toBe(bodies[1].messages[0].content)
  expect(bodies[2].messages[0].content).toContain('within 1000 tokens')
  expect(JSON.stringify(bodies)).not.toContain('TRUNCATED_UNSAFE')
  const committed = bodies.filter((_, i) => i !== 1).map(b => JSON.parse(b.messages[1].content).newEvidence).join('')
  expect(committed).toBe(evidence)
  for (const body of bodies) expect(body.messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0)).toBeLessThanOrEqual(6000)
})
it('bounds repeated output-limit retries without advancing or claiming completion', async () => {
  const progress = vi.fn()
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'incomplete' } }] }) })
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('prior', 'x'.repeat(10000), new AbortController().signal, progress)).rejects.toThrow('four bounded')
  expect(fetcher).toHaveBeenCalledTimes(4)
  for (const call of fetcher.mock.calls) {
    const body = JSON.parse(call[1].body), fragment = JSON.parse(body.messages[1].content)
    expect(body.max_tokens).toBeGreaterThanOrEqual(1680)
    expect(body.max_tokens).toBeLessThanOrEqual(2048)
    expect(body.messages.reduce((n: number, m: { content: string }) => n + new TextEncoder().encode(m.content).length, 0) + body.max_tokens + 512).toBeLessThanOrEqual(8192)
    expect(fragment.evidenceOffset).toBe(0)
    expect(fragment.previousSummary).toBe('prior')
  }
  expect(progress.mock.calls.every(([completed]) => completed === 0)).toBe(true)
})
it('does not retry HTTP or empty-output failures as output limits', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 })
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', 'evidence', new AbortController().signal)).rejects.toThrow('503')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('reserves the full output allowance for byte-bounded multilingual inputs', async () => {
  const bodies: { max_tokens: number; messages: { content: string }[] }[] = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Complete summary' } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'model')('', 'short', new AbortController().signal)
  await summarizeWithDstar('http://localhost/v1', 'model')('한'.repeat(1100), '한'.repeat(800), new AbortController().signal)
  expect(bodies[0].max_tokens).toBe(2048)
  expect(bodies.every(body => body.max_tokens === 2048)).toBe(true)
  for (const body of bodies) {
    const inputBytes = body.messages.reduce((n, m) => n + new TextEncoder().encode(m.content).length, 0)
    expect(inputBytes + body.max_tokens + 512).toBeLessThanOrEqual(8192)
  }
})

it('continues all evidence after a large completed merge and checkpoints the repack at the same offset', async () => {
  const committed: string[] = [], saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  let merges = 0, repacks = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    if ('historicalHandoff' in input) repacks++
    else { merges++; committed.push(input.newEvidence) }
    const text = 'historicalHandoff' in input ? 'Repacked confirmed facts' : merges === 1 ? '한'.repeat(1800) : 'Complete memory'
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: text } }] }) }
  }))
  const evidence = 'evidence'.repeat(1500)
  await summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined,
    { save: async c => { saved.push(structuredClone(c)) } })
  expect(repacks).toBeGreaterThan(0)
  expect(committed.join('')).toBe(evidence)
  expect(saved[1].offset).toBe(saved[0].offset)
  expect(saved[1].summary).toContain('Repacked')
  expect(saved.at(-1)?.offset).toBe(Array.from(evidence).length)
})
it('resumes durable fragments after failure and rejects checkpoints for changed evidence', async () => {
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = [], offsets: number[] = []
  let requests = 0, fail = true
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    offsets.push(input.evidenceOffset)
    if (++requests === 2 && fail) throw new Error('disconnected')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Verified memory' } }] }) }
  }))
  const evidence = 'x'.repeat(5000), save = async (c: import('../dstar-context-compaction').SummaryCheckpoint) => { saved.push(structuredClone(c)) }
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined, { save })).rejects.toThrow('disconnected')
  const checkpoint = saved[0]; expect(checkpoint.offset).toBe(2400)
  fail = false; offsets.length = 0
  await summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined, { resume: checkpoint, save })
  expect(offsets[0]).toBe(2400)
  offsets.length = 0
  await summarizeWithDstar('http://localhost/v1', 'model')('', evidence + 'edited', new AbortController().signal, undefined, { resume: checkpoint, save })
  expect(offsets[0]).toBe(0)
})
it('stops before another fragment if durable checkpoint storage fails', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'memory' } }] }) })
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', 'x'.repeat(8000), new AbortController().signal, undefined,
    { save: async () => { throw new Error('disk full') } })).rejects.toThrow('disk full')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('bounds repack attempts without committing oversized output', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(5000) } }] }) })
  vi.stubGlobal('fetch', fetcher)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('x'.repeat(7000), 'new', new AbortController().signal)).rejects.toThrow('repack exceeded')
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('finishes a long merge beyond eighteen sections while repeatedly repacking growing memory', async () => {
  const evidence = 'source'.repeat(10000), committed: string[] = []
  let merges = 0, repacks = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    const repack = 'historicalHandoff' in input
    if (repack) repacks++
    else { merges++; committed.push(input.newEvidence) }
    const content = repack ? 'Confirmed decisions and unresolved work retained.' : merges % 3 === 0 ? '한'.repeat(1800) : 'Verified accumulated memory'
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal)
  expect(merges).toBeGreaterThan(18)
  expect(repacks).toBeGreaterThan(3)
  expect(committed.join('')).toBe(evidence)
})

it('halves the actual byte-limited evidence rather than repeating identical requests', async () => {
  const bodies: { max_tokens: number; messages: { content: string }[] }[] = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'unfinished' } }] }) }
  }))
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('한'.repeat(1100), '한'.repeat(3000), new AbortController().signal)).rejects.toThrow('four bounded')
  const lengths = bodies.map(b => Array.from(JSON.parse(b.messages[1].content).newEvidence).length)
  expect(lengths[0]).toBeLessThan(1200)
  for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBe(Math.floor(lengths[i - 1] / 2))
  expect(bodies.every(b => b.max_tokens === 2048)).toBe(true)
})

it('checkpoints source-backed open requests separately and preserves them through a prose repack', async () => {
  const source = [{ id: 'ask', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Find the shop. Keep this unfinished until verified.' }] }]
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  let merges = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    const repack = 'historicalHandoff' in input
    const content = repack ? 'Compact prose' : JSON.stringify({ summary: ++merges === 1 ? '한'.repeat(1600) : 'Short memory', openRequests: merges === 1 ? [{ id: 'ask', request: 'Find the shop' }] : [], resolvedRequests: [] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'model')('', 'evidence'.repeat(1800), new AbortController().signal, undefined, { requestSources: source, save: async c => { saved.push(structuredClone(c)) } })
  expect(saved.length).toBeGreaterThan(3)
  expect(saved.at(-1)?.requests?.open).toEqual([{ id: 'ask', request: 'Find the shop', sourceText: source[0].parts[0].text }])
  expect(saved.every(c => c.requests?.open[0]?.id === 'ask')).toBe(true)
})
it('resumes the independent work ledger from its durable checkpoint after an interruption', async () => {
  const source = [{ id: 'request-resume', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Look up a verified address.' }] }]
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  const offsets: number[] = []; let attempt = 0; let fail = true
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    offsets.push(input.evidenceOffset)
    if (++attempt === 2 && fail) throw new Error('interrupted work summary')
    const content = JSON.stringify({ summary: 'Short memory', openRequests: attempt === 1 ? [{ id: 'request-resume', request: 'Verify address' }] : [], resolvedRequests: [] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  const save = async (c: import('../dstar-context-compaction').SummaryCheckpoint) => { saved.push(structuredClone(c)) }
  const evidence = 'Evidence '.repeat(1500)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined, { requestSources: source, save })).rejects.toThrow('interrupted')
  const resume = saved.at(-1)!
  expect(resume.requests?.open[0].id).toBe('request-resume')
  fail = false; offsets.length = 0
  await summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined, { requestSources: source, resume, save })
  expect(offsets[0]).toBe(resume.offset)
  expect(saved.at(-1)?.requests?.open[0].id).toBe('request-resume')
  expect(saved.at(-1)?.offset).toBe(Array.from(evidence).length)
})

it('checkpoints and completes every fragment despite unsupported completion claims', async () => {
  const source = [{ id: 'pending', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Verify the shop address.' }] }]
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  let calls = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    const content = JSON.stringify({ summary: 'The address still needs verification.',
      openRequests: ++calls === 1 ? [{ id: 'pending', request: 'Verify shop address' }] : [],
      resolvedRequests: [{ id: 'pending', evidenceId: 'missing', quote: 'unsupported completion' }] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  const evidence = 'Historical evidence. '.repeat(400)
  const result = await summarizeWithDstar('http://localhost/v1', 'model')('', evidence, new AbortController().signal, undefined,
    { requestSources: source, save: async c => { saved.push(structuredClone(c)) } })
  expect(result).toBe('The address still needs verification.')
  expect(calls).toBeGreaterThan(1)
  expect(saved.at(-1)?.offset).toBe(Array.from(evidence).length)
  expect(saved.every(c => c.requests?.open[0]?.id === 'pending' && c.requests.resolved.length === 0)).toBe(true)
})

it('repairs an assistant-as-user source against the same evidence and saves only the validated ledger', async () => {
  const source = [
    { id: 'ask', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Verify the address.' }] },
    { id: 'promise', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'I will check.' }] },
  ]
  const bodies: { messages: { content: string }[] }[] = []
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    const content = JSON.stringify({ summary: 'The address is unverified.',
      openRequests: [{ id: bodies.length === 1 ? 'promise' : 'ask', request: 'Verify address' }], resolvedRequests: [] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'model')('', 'Short evidence', new AbortController().signal, undefined,
    { requestSources: source, save: async point => { saved.push(structuredClone(point)) } })
  expect(bodies).toHaveLength(2)
  expect(bodies[1].messages[1].content).toBe(bodies[0].messages[1].content)
  expect(bodies[1].messages[0].content).toContain('user-only allowlist: ["ask"]')
  expect(saved).toHaveLength(1)
  expect(saved[0].requests?.open[0].id).toBe('ask')
})
it('bounds invalid-source repair to three additional requests without saving invalid progress', async () => {
  const source = [{ id: 'ask', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Verify the address.' }] }]
  const previous = { open: [{ id: 'ask', request: 'Verify address', sourceText: 'Verify the address.' }], resolved: [] }
  const before = structuredClone(previous)
  const save = vi.fn(), bodies: string[] = []
  const fetch = vi.fn().mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(init.body).messages[1].content)
    const content = JSON.stringify({ summary: 'Memory', openRequests: [{ id: 'invented', request: 'Verify address' }], resolvedRequests: [] })
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content } }] }) }
  })
  vi.stubGlobal('fetch', fetch)
  await expect(summarizeWithDstar('http://localhost/v1', 'model')('', 'Short evidence', new AbortController().signal, undefined,
    { requestSources: source, previousRequests: previous, save })).rejects.toThrow('three repair attempts')
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(new Set(bodies).size).toBe(1)
  expect(save).not.toHaveBeenCalled()
  expect(previous).toEqual(before)
})


it('repacks short prose when the retained request ledger fills the input envelope', async () => {
  const source = Array.from({ length: 4 }, (_, i) => ({ id: `request-${i}`, role: 'user' as const,
    parts: [{ type: 'text' as const, text: `Verify obligation ${i}` }] }))
  const previousRequests = { open: source.map(m => ({ id: m.id, request: '한'.repeat(130), sourceText: m.parts[0].text })), resolved: [] }
  const saved: import('../dstar-context-compaction').SummaryCheckpoint[] = []
  let repacks = 0, merges = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content)
    expect(new TextEncoder().encode(body.messages[0].content).length + new TextEncoder().encode(body.messages[1].content).length).toBeLessThanOrEqual(5632)
    const repack = 'historicalHandoff' in input
    if (repack) repacks++
    else {
      merges++
      expect(input.newEvidence).toBe('last fragment')
      expect(input.openRequests).toEqual(previousRequests.open.map(({ id, request }) => ({ id, request })))
    }
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: repack ? 'Compact confirmed memory' : JSON.stringify({ summary: 'Final memory', openRequests: [], resolvedRequests: [] }) } }] }) }
  }))
  await summarizeWithDstar('http://localhost/v1', 'model')('한'.repeat(1060), 'last fragment', new AbortController().signal, undefined,
    { requestSources: source, previousRequests, save: async c => { saved.push(structuredClone(c)) } })
  expect(repacks).toBe(1)
  expect(merges).toBe(1)
  expect(saved.at(-1)?.offset).toBe(13)
  expect(saved.every(c => c.requests?.open.length === 4)).toBe(true)
  expect(previousRequests.open).toHaveLength(4)
})
