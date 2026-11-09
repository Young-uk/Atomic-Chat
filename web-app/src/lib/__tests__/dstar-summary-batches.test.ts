import { afterEach, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { summarizeBatchesWithDstar } from '../dstar-summary-batches'
import { ContextCompaction, type ArchiveRecord, type Summarize } from '../dstar-context-compaction'

const turn = (n: number): UIMessage[] => [
  { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `Request ${n}` }] },
  { id: `a${n}`, role: 'assistant', parts: [{ type: 'text', text: `Result ${n}` }] },
]
const settle = async () => { for (let i = 0; i < 120; i++) await Promise.resolve() }
afterEach(() => vi.unstubAllGlobals())

it('extracts independently, commits each batch and consolidates five without changing raw history', async () => {
  const saved: ArchiveRecord[] = []
  const summarize = vi.fn(async (previous, _evidence, _signal, _progress, cp) => {
    expect(previous).toBe('')
    const summary = `segment:${cp.requestSources[0].id}`
    await cp.save({ version: 1, inputKey: summary, offset: 1, completed: 1, summary, requests: { open: [], resolved: [] } })
    return summary
  }) as unknown as Summarize
  const consolidate = vi.fn(async batches => [{ id: 'combined', summary: 'Five chronological segments', sourceEndId: batches[4].sourceEndId }])
  summarize.batches = { selectCompletePrefix: async () => 2, consolidate }
  const store = { save: async (r: ArchiveRecord) => { saved.push(structuredClone(r)) }, load: async () => saved.filter(r => r.summary).at(-1) }
  const c = new ContextCompaction('batch-thread', store)
  const messages = Array.from({ length: 6 }, (_, n) => turn(n)).flat()
  const original = structuredClone(messages)
  c.schedule(messages, 1, 100000, summarize)
  await settle()
  expect(c.error).toBeUndefined()
  expect(consolidate).toHaveBeenCalledTimes(1)
  expect(consolidate.mock.calls[0][0]).toHaveLength(5)
  expect(saved.filter(r => r.summary)).toHaveLength(7)
  expect(saved.at(-1)?.batches).toHaveLength(2)
  expect(messages).toEqual(original)
  const restarted = new ContextCompaction('batch-thread', store)
  await restarted.initialize()
  const next = turn(9)[0]
  const view = restarted.apply([...messages, next])
  expect(view.at(-1)?.id).toBe(next.id)
  expect(JSON.stringify(view)).toContain('Five chronological segments')
})

it('does not count existing summaries or provider prompt usage toward the raw-history trigger', async () => {
  const source = turn(0)
  const saved: ArchiveRecord = { version: 1, id: 'old', threadId: 'threshold', source, previousSummary: '', summary: 'x'.repeat(100000) }
  const c = new ContextCompaction('threshold', { save: async () => {}, load: async () => saved })
  await c.initialize()
  const summarize = vi.fn() as unknown as Summarize
  summarize.batches = { selectCompletePrefix: vi.fn(), consolidate: vi.fn() }
  c.schedule([...source, ...turn(1)], 65536, 65000, summarize)
  await settle()
  expect(summarize.batches.selectCompletePrefix).not.toHaveBeenCalled()
  expect(c.status).toBe('idle')
  expect(c.apply([...source, ...turn(1)]).at(-1)?.id).toBe('a1')
})

it('selects complete tool-bearing turns with the full token-counted extraction and repair envelope', async () => {
  const calls: { messages: { content: string }[]; think: boolean; max_tokens: number }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    const segment = JSON.parse(body.messages[1].content).segment
    return { ok: true, json: async () => ({ input_tokens: segment.length <= 3 ? 13312 : 13313, context_length: 16384 }) }
  }))
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  const messages = [...turn(0), { id: 'tool-result', role: 'assistant', parts: [{ type: 'text', text: 'Tool result and final answer' }] }, ...turn(1)] as UIMessage[]
  expect(await summarize.batches!.selectCompletePrefix(messages, undefined, new AbortController().signal)).toBe(3)
  expect(calls.every(c => c.think === false && c.max_tokens === 2048)).toBe(true)
  expect(calls.some(c => c.messages[2].content.includes('user-message IDs'))).toBe(true)
})

it('reduces five to four when the actual consolidation envelope exceeds 13312 tokens', async () => {
  const counts: number[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    const summaries = JSON.parse(body.messages[1].content).summaries
    if (url.endsWith('summary-token-count')) {
      counts.push(summaries.length)
      return { ok: true, json: async () => ({ input_tokens: summaries.length === 5 ? 14000 : 12000, context_length: 16384 }) }
    }
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Consolidated four' } }] }) }
  }))
  const batches = Array.from({ length: 5 }, (_, n) => ({ id: String(n), summary: `Summary ${n}`, sourceEndId: `a${n}` }))
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  const result = await summarize.batches!.consolidate(batches, undefined, new AbortController().signal)
  expect(counts.slice(0, 2)).toEqual([5, 4])
  expect(result).toHaveLength(2)
  expect(result[0].sourceEndId).toBe('a3')
  expect(result[1]).toEqual(batches[4])
  expect(batches).toHaveLength(5)
})

it('keeps originals and reports an oversized complete turn instead of slicing it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ input_tokens: 14000, context_length: 16384 }) })))
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  await expect(summarize.batches!.selectCompletePrefix(turn(0), undefined, new AbortController().signal)).rejects.toThrow('No complete conversation turn fits')
})

it('preserves unfinished work across independent extraction and reuses a completed checkpoint', async () => {
  let requests = 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    expect(body.think).toBe(false)
    if (url.endsWith('summary-token-count')) return { ok: true, json: async () => ({ input_tokens: 1000, context_length: 16384 }) }
    requests++
    expect(JSON.parse(body.messages[1].content)).not.toHaveProperty('previousSummary')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'New segment facts', openRequests: [], resolvedRequests: [] }) } }] }) }
  }))
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  const ledger = { open: [{ id: 'old-request', request: 'Still unfinished', sourceText: 'Please do this' }], resolved: [] }
  const save = vi.fn()
  const messages = turn(1), signal = new AbortController().signal
  const summary = await summarize('Must not re-summarize this', 'evidence', signal, undefined, { requestSources: messages, previousRequests: ledger, save })
  expect(save.mock.calls[0][0].requests.open).toEqual(ledger.open)
  expect(await summarize('Ignored old summary', 'evidence', signal, undefined, { requestSources: messages, previousRequests: ledger, save, resume: save.mock.calls[0][0] })).toBe(summary)
  expect(requests).toBe(1)
})

it('does not summarize an unfinished tool call or a leading instruction by itself', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ input_tokens: 1000, context_length: 16384 }) })))
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  const messages: UIMessage[] = [{ id: 's', role: 'system', parts: [{ type: 'text', text: 'Instruction' }] }, turn(0)[0],
    { id: 'pending', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'search', toolCallId: 'call', state: 'input-available', input: {} }] }]
  await expect(summarize.batches!.selectCompletePrefix(messages, undefined, new AbortController().signal)).rejects.toThrow('No complete conversation turn fits')
})

it('resumes completed extraction after a failed five-batch consolidation without generating it again', async () => {
  const saved: ArchiveRecord[] = []
  let generated = 0, consolidations = 0
  const summarize: Summarize = async (_previous, _evidence, _signal, _progress, cp) => {
    if (cp?.resume?.summary) return cp.resume.summary
    generated++
    const summary = `Segment ${generated}`
    await cp!.save({ version: 1, inputKey: 'test', offset: 1, completed: 1, summary, requests: { open: [], resolved: [] } })
    return summary
  }
  summarize.batches = { selectCompletePrefix: async () => 2, consolidate: async batches => {
    if (++consolidations === 1) throw new Error('Interrupted consolidation')
    return [{ id: 'combined', summary: 'All five segments', sourceEndId: batches[4].sourceEndId }]
  } }
  const store = { save: async (r: ArchiveRecord) => { saved.push(structuredClone(r)) },
    load: async () => saved.filter(r => r.summary).at(-1),
    loadPending: async () => saved.filter(r => !r.summary && r.checkpoint).at(-1) }
  const messages = Array.from({ length: 5 }, (_, n) => turn(n)).flat()
  const c = new ContextCompaction('resume', store)
  c.schedule(messages, 1, 10000, summarize); await settle()
  expect(c.error).toBe('Interrupted consolidation')
  expect(generated).toBe(5)
  expect(saved.at(-1)?.extractedBatches).toHaveLength(5)
  const restarted = new ContextCompaction('resume', store)
  await restarted.initialize()
  restarted.schedule(messages, 1, 10000, summarize); await settle()
  expect(restarted.error).toBeUndefined()
  expect(generated).toBe(5)
  expect(saved.at(-1)?.batches).toHaveLength(1)
  expect(saved.at(-1)?.summary).toContain('All five segments')
})

it('reduces oversized tool evidence without slicing the user turn or mutating originals', async () => {
  let reductions = 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    const payload = JSON.parse(body.messages[1].content)
    if (url.endsWith('summary-token-count')) return { ok: true, json: async () => ({
      input_tokens: body.messages[1].content.length > 3500 ? 14000 : 2000, context_length: 16384,
    }) }
    if ('excerpt' in payload) {
      reductions++
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Verified source https://example.com, result uncertain.' } }] }) }
    }
    expect(payload.segment[0].parts[0].text).toBe('Request 0')
    expect(payload.segment[1].parts.at(-1).text).toBe('Result 0')
    expect(payload.segment[1].parts[0].output).toContain('archivedOriginal')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Verified source, unfinished work retained.', openRequests: [], resolvedRequests: [] }) } }] }) }
  }))
  const messages = turn(0)
  messages[1].parts.unshift({ type: 'dynamic-tool', toolName: 'search', toolCallId: 'large', state: 'output-available', input: {}, output: 'long result '.repeat(900) })
  const original = structuredClone(messages)
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  const signal = new AbortController().signal
  expect(await summarize.batches!.selectCompletePrefix(messages, undefined, signal)).toBe(2)
  const count = reductions
  expect(count).toBeGreaterThan(1)
  const saved: unknown[] = []
  expect(await summarize('', 'evidence', signal, undefined, { requestSources: messages, save: async cp => { saved.push(cp) } })).toContain('Verified source')
  expect(reductions).toBe(count)
  expect(saved).toHaveLength(1)
  expect(messages).toEqual(original)
})

it('does not extract or commit when tool evidence reduction is incomplete', async () => {
  let extractions = 0
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith('summary-token-count')) return { ok: true, json: async () => ({
      input_tokens: body.messages[1].content.length > 3500 ? 14000 : 2000, context_length: 16384,
    }) }
    extractions++
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete evidence' } }] }) }
  }))
  const messages = turn(0)
  messages[1].parts.unshift({ type: 'dynamic-tool', toolName: 'search', toolCallId: 'large', state: 'output-available', input: {}, output: 'evidence '.repeat(900) })
  const original = structuredClone(messages)
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  await expect(summarize.batches!.selectCompletePrefix(messages, undefined, new AbortController().signal)).rejects.toThrow('Tool evidence summary did not complete')
  expect(extractions).toBe(1)
  expect(messages).toEqual(original)
})


it('retains existing work unchanged when a segment echoes an earlier request source', async () => {
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('summary-token-count')) return { ok: true, json: async () => ({ input_tokens: 1000, context_length: 16384 }) }
    calls++
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      summary: 'New segment', openRequests: [{ id: 'old', request: 'Changed echo' }, { id: 'done', request: 'Reopen echo' }, { id: 'u1', request: 'New work' }], resolvedRequests: [],
    }) } }] }) }
  }))
  const ledger = { open: [{ id: 'old', request: 'Original work', sourceText: 'Original user text' }], resolved: [{ id: 'done', evidenceId: 'a0', quote: 'Completed' }] }
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: true })
  let saved: any
  await summarize('', 'evidence', new AbortController().signal, undefined, { requestSources: turn(1), previousRequests: ledger, save: async cp => { saved = cp } })
  expect(calls).toBe(1)
  expect(saved.requests.open).toEqual([...ledger.open, { id: 'u1', request: 'New work', sourceText: 'Request 1' }])
  expect(saved.requests.resolved).toEqual(ledger.resolved)
})


it('restores a matching saved batch when a longer legacy archive is incompatible', async () => {
  const source = turn(0)
  const valid: ArchiveRecord = { version: 1, id: 'valid', threadId: 'restore', source, previousSummary: '', summary: 'Matching saved work', batches: [{ id: 'b', summary: 'Matching saved work', sourceEndId: 'a0' }] }
  const stale: ArchiveRecord = { ...valid, id: 'stale', source: [...turn(99), ...turn(1)], summary: 'Stale legacy work' }
  const c = new ContextCompaction('restore', { save: async () => {}, load: async () => stale, loadCandidates: async () => [stale, valid] })
  await c.initialize()
  const messages = [...source, ...turn(1), turn(2)[0]]
  const view = c.apply(messages)
  expect(JSON.stringify(view)).toContain('Matching saved work')
  expect(JSON.stringify(view)).not.toContain('Stale legacy work')
  expect(view.some(m => m.id === 'u0')).toBe(false)
  expect(view.at(-1)?.id).toBe('u2')
})

it('resumes recovery after the first fitting durable batch while later work remains pending', async () => {
  let finishSecond!: (text: string) => void
  let calls = 0
  const summarize = vi.fn(async () => ++calls === 1 ? 'First segment' :
    await new Promise<string>(resolve => { finishSecond = resolve })) as unknown as Summarize
  summarize.batches = { selectCompletePrefix: async () => 2, consolidate: vi.fn() }
  const c = new ContextCompaction('early', { load: async () => undefined, save: async () => {} })
  const messages = [...turn(0), ...turn(1), turn(2)[0]]
  // Start a backlog job first, as happens when a new message arrives during
  // background extraction. It must keep running after foreground recovery.
  c.schedule(messages, 1, 10000, summarize)
  const recovery = c.recover(messages, 1000, summarize, undefined, 10, view =>
    view.some(m => m.role === 'system') ? 500 : 2000)
  await settle()
  await recovery
  expect(c.status).toBe('summarizing')
  expect(c.apply(messages).some(m => m.id === 'u0')).toBe(false)
  finishSecond('Second segment')
  await settle()
  expect(c.error).toBeUndefined()
})

it('waits for another batch when the first saved summary still cannot fit', async () => {
  let finishSecond!: (text: string) => void
  let calls = 0
  const summarize = vi.fn(async () => ++calls === 1 ? 'First' :
    await new Promise<string>(resolve => { finishSecond = resolve })) as unknown as Summarize
  summarize.batches = { selectCompletePrefix: async () => 2, consolidate: vi.fn() }
  const c = new ContextCompaction('enough', { load: async () => undefined, save: async () => {} })
  let resumed = false
  const messages = [...turn(0), ...turn(1), turn(2)[0]]
  const recovery = c.recover(messages, 1000, summarize, undefined, 10,
    view => view.some(m => m.id === 'u1') ? 2000 : 500).then(() => { resumed = true })
  await settle()
  expect(resumed).toBe(false)
  finishSecond('Second')
  await recovery
  expect(resumed).toBe(true)
  expect(c.apply(messages).at(-1)?.id).toBe('u2')
})

it('publishes the fifth extraction before consolidation and preserves an adopted record', async () => {
  let finishMerge!: (batches: { id: string; summary: string; sourceEndId: string }[]) => void
  const summarize = vi.fn(async () => 'Segment') as unknown as Summarize
  summarize.batches = { selectCompletePrefix: async () => 2,
    consolidate: () => new Promise(resolve => { finishMerge = resolve }) }
  const c = new ContextCompaction('merge', { load: async () => undefined, save: async () => {} })
  const messages = [...Array.from({ length: 5 }, (_, n) => turn(n)).flat(), turn(5)[0]]
  c.schedule(messages, 1, 100000, summarize)
  await settle()
  const adopted = c.apply(messages)
  expect(JSON.stringify(adopted)).toContain('Historical segment 5:')
  finishMerge([{ id: 'merged', summary: 'Merged', sourceEndId: 'a4' }])
  await settle()
  expect(JSON.stringify(adopted)).toContain('Historical segment 5:')
  expect(JSON.stringify(c.apply(messages))).toContain('Merged')
})

it('continues a normal background checkpoint if its raw threshold stops before foreground fit', async () => {
  let finishFirst!: (text: string) => void
  let calls = 0
  const summarize = vi.fn(async () => ++calls === 1 ?
    await new Promise<string>(resolve => { finishFirst = resolve }) : 'Next') as unknown as Summarize
  summarize.batches = { selectCompletePrefix: async () => 2, consolidate: vi.fn() }
  const c = new ContextCompaction('continue', { load: async () => undefined, save: async () => {} })
  const messages = [...turn(0), ...turn(1), turn(2)[0]]
  // Explicit recovery boundary one simulates an already scheduled bounded job
  // that finishes after its first batch rather than consuming the whole backlog.
  c.schedule(messages, 1000, 10000, summarize, 1)
  await settle()
  const recovery = c.recover(messages, 1000, summarize, undefined, 10,
    view => view.some(m => m.id === 'u1') ? 2000 : 500)
  finishFirst('First')
  await recovery
  expect(calls).toBe(2)
  expect(c.apply(messages).at(-1)?.id).toBe('u2')
})


it('uses tokenizer counts when raw dialogue exceeds sixty percent despite a small character estimate', async () => {
  const summarize = vi.fn(async () => 'handoff') as unknown as Summarize
  const countRawTokens = vi.fn().mockResolvedValueOnce(40000).mockResolvedValue(0)
  summarize.batches = { countRawTokens, selectCompletePrefix: vi.fn(async () => 2), consolidate: vi.fn() }
  const c = new ContextCompaction('raw-token-threshold', { save: async () => {}, load: async () => undefined })
  c.schedule(turn(1), 65536, 1, summarize)
  await settle()
  expect(summarize).toHaveBeenCalledTimes(1)
  expect(countRawTokens).toHaveBeenCalledWith(turn(1), expect.any(AbortSignal))
  expect(c.error).toBeUndefined()
  expect(JSON.stringify(c.previewReady([...turn(1), ...turn(2)]))).toContain('handoff')
})

it('starts a bounded batch under foreground pressure even below the raw-history threshold', async () => {
  const summarize = vi.fn(async () => 'handoff') as unknown as Summarize
  const countRawTokens = vi.fn().mockResolvedValue(100)
  summarize.batches = { countRawTokens, selectCompletePrefix: vi.fn(async () => 2), consolidate: vi.fn() }
  const saved: ArchiveRecord[] = []
  const c = new ContextCompaction('prompt-pressure', { save: async r => { saved.push(structuredClone(r)) }, load: async () => undefined })
  const messages = [...turn(1), ...turn(2)]
  const original = structuredClone(messages)
  const promptCost = vi.fn((view: UIMessage[]) => view.some(m => m.id.startsWith('atomic-context-')) ? 40000 : 62000)
  c.schedule(messages, 65536, 62000, summarize, undefined, promptCost)
  await settle()
  expect(summarize).toHaveBeenCalledTimes(1)
  expect(saved.at(-1)?.trigger).toMatchObject({ reason: 'prompt-pressure', rawTokens: 100, rawThreshold: 39321.6, promptTokens: 62000, pressureThreshold: 55705.6, tokenizer: true })
  expect(countRawTokens).toHaveBeenCalled()
  expect(messages).toEqual(original)
  expect(c.error).toBeUndefined()
  expect(JSON.stringify(c.previewReady([...messages, ...turn(3)]))).toContain('handoff')
})

it('leaves low raw history alone when the complete foreground envelope has room', async () => {
  const summarize = vi.fn() as unknown as Summarize
  summarize.batches = { countRawTokens: vi.fn(async () => 100), selectCompletePrefix: vi.fn(), consolidate: vi.fn() }
  const c = new ContextCompaction('no-pressure', { save: async () => {}, load: async () => undefined })
  c.schedule(turn(1), 65536, 65000, summarize, undefined, () => 40000)
  await settle()
  expect(summarize).not.toHaveBeenCalled()
  expect(c.status).toBe('idle')
})

it('retains raw archives without committing derived state on admission refusal and suppresses repeated inference', async () => {
  const { SummaryAdmission } = await import('../atomic-summary-admission')
  const admission = new SummaryAdmission(8192)
  admission.observeForeground(7000, 'completed-foreground')
  const fetcher = vi.fn(async (url: string) => url.endsWith('/summary-token-count')
    ? { ok: true, json: async () => ({ input_tokens: 6000, context_length: 16384 }) }
    : { ok: false, status: 409, json: async () => ({ error: { code: 'atomic_summary_admission_refused' } }) })
  vi.stubGlobal('fetch', fetcher)
  const saved: ArchiveRecord[] = []
  const c = new ContextCompaction('refusal', { load: async () => undefined,
    save: async record => { saved.push(structuredClone(record)) } })
  const summarize = summarizeBatchesWithDstar('http://strata/v1', 'model', { tokenCounting: true, admission })
  const messages = turn(1), original = structuredClone(messages)
  c.schedule(messages, 65536, 6000, summarize)
  await vi.waitFor(() => expect(c.status).toBe('idle'))
  expect(saved).toEqual([])
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/chat/completions'))).toBe(false)
  c.schedule(messages, 8192, 6000, summarize)
  await vi.waitFor(() => expect(c.status).toBe('idle'))
  expect(admission.allowed).toBe(false)
  expect(c.error).toContain('server safety admission')
  expect(saved.length).toBeGreaterThan(0)
  expect(saved.every(record => !record.summary && !record.checkpoint)).toBe(true)
  expect(saved[0].source).toEqual(original)
  expect(c.apply(messages)).toEqual(original)
  const calls = fetcher.mock.calls.filter(([url]) => url.endsWith('/chat/completions')).length
  await expect(summarize('', 'evidence', new AbortController().signal, undefined,
    { requestSources: messages, save: async () => {} })).rejects.toThrow('deferred')
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/chat/completions'))).toHaveLength(calls)
  expect(messages).toEqual(original)
})


it('marks only explicitly urgent generation requests for recovery priority', async () => {
  for (const recovery of [false, true]) {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Combined handoff' } }] }) }
    }))
    const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', { tokenCounting: false, recovery })
    await summarize.batches!.consolidate([
      { id: 'one', summary: 'One', sourceEndId: 'a0' },
      { id: 'two', summary: 'Two', sourceEndId: 'a1' },
    ], undefined, new AbortController().signal)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].atomic_summary_recovery).toBe(recovery ? true : undefined)
    expect(summarize.recoveryPriority).toBe(recovery)
  }
})

it('explains state-bank safety refusals without a legacy admission envelope', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/summary-token-count')
    ? { ok: true, json: async () => ({ input_tokens: 6000, context_length: 16384 }) }
    : { ok: false, status: 409, json: async () => ({ error: { code: 'atomic_summary_admission_refused' } }) }))
  const summarize = summarizeBatchesWithDstar('http://strata/v1', 'model', { tokenCounting: true, recovery: true })
  const messages = turn(1), original = structuredClone(messages), save = vi.fn()
  await expect(summarize('', 'evidence', new AbortController().signal, undefined,
    { requestSources: messages, save })).rejects.toThrow('server safety admission; originals retained')
  expect(save).not.toHaveBeenCalled()
  expect(messages).toEqual(original)
})

it('only accepts input progress from its current pending summary signal', async () => {
  const events: Array<{ input?: unknown } | undefined> = []
  let owner!: AbortSignal, finish!: () => void
  const summarize = (async (_p: string, _e: string, signal: AbortSignal) => {
    owner = signal
    await new Promise<void>(resolve => { finish = resolve })
    return 'handoff'
  }) as Summarize
  const c = new ContextCompaction('input-owner', { load: async () => undefined, save: async () => {} }, p => events.push(p))
  c.schedule([...turn(1), ...turn(2)], 1, 100000, summarize, 2)
  await vi.waitFor(() => expect(owner).toBeDefined())
  c.reportInput(owner, { phase: 'reading', processed: 10, total: 100, cache: 0 })
  expect(events.at(-1)?.input).toMatchObject({ processed: 10, total: 100 })
  const count = events.length
  c.reportInput(new AbortController().signal, { phase: 'reading', processed: 90, total: 100 })
  expect(events).toHaveLength(count)
  c.cancel(); c.reportInput(owner, { phase: 'reading', processed: 99, total: 100 })
  expect(events.at(-1)?.input).not.toEqual(expect.objectContaining({ processed: 99 }))
  finish(); await settle()
})

it('numbers actual summary requests so a new input phase is not mistaken for generation going backwards', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('summary-token-count')
    ? { ok: true, json: async () => ({ input_tokens: 1000, context_length: 16384 }) }
    : { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ summary: 'Facts', openRequests: [], resolvedRequests: [] }),
    } }] }) }))
  const requests: number[] = []
  const summarize = summarizeBatchesWithDstar('http://dstar/v1', 'qwen', {
    tokenCounting: true, inputProgress: input => { if (input) requests.push(input.request!) },
  })
  const signal = new AbortController().signal
  for (let n = 0; n < 2; n++) await summarize('', 'evidence', signal, undefined,
    { requestSources: turn(1), save: async () => {} })
  expect(requests).toEqual([1, 2])
})
