import { afterEach, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { bindStrataHistory, strataHistoryHash, resumeRestoredStrataSummary, summarizeWithStrataCache } from '../strata-cached-summary'
import { ContextCompaction, compactionBoundary, type ArchiveRecord, type Summarize } from '../dstar-context-compaction'

vi.mock('../dstar-context-archive', () => ({ fetchDstarContext: (...args: unknown[]) => fetch(...args as Parameters<typeof fetch>) }))
vi.mock('../summary-stream', async importOriginal => ({ ...await importOriginal<typeof import('../summary-stream')>(),
  readSummaryChoice: async (response: Response) => (await response.json()).choices[0],
}))
afterEach(() => vi.unstubAllGlobals())
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
const history = (): UIMessage[] => Array.from({ length: 10 }, (_, i) => [
  { id: `u${i}`, role: 'user' as const, parts: [{ type: 'text' as const, text: `Question ${i} ${'q'.repeat(300)}` }] },
  { id: `a${i}`, role: 'assistant' as const, parts: [{ type: 'text' as const, text: `Result ${i} ${'a'.repeat(300)}` }] },
]).flat()

it('sends only source anchors and one task to the bound clone, preserving the verified ledger', async () => {
  const messages = history().slice(0, 4)
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    summary: 'Confirmed historical facts', openRequests: [], resolvedRequests: [{ id: 'old', evidenceId: 'a1', quote: 'invented completion' }],
  }) } }] }))
  vi.stubGlobal('fetch', fetcher)
  const save = vi.fn(async (_checkpoint: import('../dstar-context-compaction').SummaryCheckpoint) => {})
  const summarize = summarizeWithStrataCache('http://local/v1', 'model', 'thread/turn', {})
  const signal = new AbortController().signal
  expect(await summarize('Prior handoff', 'raw evidence must not be replayed', signal, undefined, { save, requestSources: messages,
    previousRequests: { open: [{ id: 'old', request: 'Keep unfinished task', sourceText: 'Original' }], resolved: [] } })).toBe('Confirmed historical facts')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const init = fetcher.mock.calls[0][1] as RequestInit
  const body = JSON.parse(init.body as string)
  expect(body.atomic_summary_clone).toBe('thread/turn')
  expect(body.temperature).toBe(1)
  expect(body.messages).toHaveLength(1)
  expect(body.messages[0].content).not.toContain('raw evidence must not be replayed')
  expect(body.messages[0].content).not.toContain('q'.repeat(300))
  expect(init.signal).toBe(signal)
  expect(save.mock.calls[0][0].requests.open[0].id).toBe('old')
})

it('retains originals and does not retry an unrelated foreground cache', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: { code: 'atomic_summary_clone_stale', message: 'Cache changed; originals retained' } }, { status: 409 }))
  vi.stubGlobal('fetch', fetcher)
  const save = vi.fn(async (_checkpoint: import('../dstar-context-compaction').SummaryCheckpoint) => {})
  await expect(summarizeWithStrataCache('http://local/v1', 'm', 'thread/turn', {})('', '', new AbortController().signal,
    undefined, { save, requestSources: history() })).rejects.toThrow('Cache changed')
  expect(save).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('summarizes one frozen older prefix and retains appended dialogue without changing raw history', async () => {
  const saved: ArchiveRecord[] = []
  let finish!: (value: string) => void
  const summarize = vi.fn(async () => await new Promise<string>(resolve => { finish = resolve })) as unknown as Summarize
  summarize.cached = true
  const messages = history(), original = structuredClone(messages)
  const store = { save: async (record: ArchiveRecord) => { saved.push(structuredClone(record)) }, load: async () => saved.findLast(record => !!record.summary) }
  const coordinator = new ContextCompaction('thread', store)
  const boundary = compactionBoundary(messages, 1000)
  coordinator.schedule(messages, 1000, 950, summarize, undefined, () => 950)
  await settle()
  expect(summarize).toHaveBeenCalledTimes(1)
  finish('One historical handoff')
  await settle()
  expect(coordinator.error).toBeUndefined()
  expect(saved.at(-1)?.source).toEqual(original.slice(0, boundary))
  const next: UIMessage = { id: 'new', role: 'user', parts: [{ type: 'text', text: 'Arrived during summary' }] }
  const arrived: UIMessage[] = [
    { id: 'during-user', role: 'user', parts: [{ type: 'text', text: 'Question while summarizing' }] },
    { id: 'during-answer', role: 'assistant', parts: [{ type: 'text', text: 'Answer while summarizing' }] },
  ]
  const view = coordinator.apply([...messages, ...arrived, next])
  const summaryIndex = view.findIndex(message => message.id.startsWith('atomic-context-'))
  expect(view[summaryIndex - 1].id).toBe('during-answer')
  expect(view[summaryIndex + 1].id).toBe('new')
  expect(view.filter(message => !message.id.startsWith('atomic-context-'))).toEqual([...original.slice(boundary), ...arrived, next])
  expect(messages).toEqual(original)
})

it('uses the running tokenizer for the 60% trigger before starting a clone', async () => {
  const saved: ArchiveRecord[] = []
  const summarize = vi.fn(async () => 'Summary') as unknown as Summarize
  summarize.cached = true
  summarize.countRawTokens = vi.fn(async () => 500)
  const coordinator = new ContextCompaction('thread', { save: async record => { saved.push(record) }, load: async () => undefined })
  coordinator.schedule(history(), 1000, 800, summarize)
  await settle()
  expect(summarize.countRawTokens).toHaveBeenCalledTimes(1)
  expect(summarize).not.toHaveBeenCalled()
  expect(saved).toHaveLength(0)
  expect(coordinator.error).toBeUndefined()
})


it('bootstraps a restored cache before the first foreground request without replaying history', async () => {
  const messages: UIMessage[] = [...history(), {id:'pending', role:'user', parts:[{type:'text',text:'New question'}]}]
  const original = structuredClone(messages)
  const saved: ArchiveRecord[] = []
  const coordinator = new ContextCompaction('thread', {load:async()=>undefined, save:async record=>{ saved.push(structuredClone(record)) }})
  const requests: Array<{url:string; body?:Record<string, unknown>}> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?:RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    requests.push({url,body})
    if (url.endsWith('/status')) return Response.json({loaded:true, atomic_summary:{restored_cache_owner:'thread/u9',restored_cache_hash:await strataHistoryHash(history())}})
    if (url.endsWith('/summary-token-count')) return Response.json({input_tokens:900})
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Restored handoff',openRequests:[],resolvedRequests:[]})}}]})
  }))
  expect(await resumeRestoredStrataSummary('http://local/v1','m','thread',messages,messages,1000,coordinator,new AbortController().signal,{})).toBe(true)
  expect(requests.map(r=>r.url.split('/').at(-1))).toEqual(['status','summary-token-count','completions'])
  expect(requests.at(-1)?.body?.atomic_summary_clone).toBe('thread/u9')
  expect(saved.at(-1)?.summary).toBe('Restored handoff')
  expect(saved.at(-1)?.source.some(m=>m.id==='pending')).toBe(false)
  expect(coordinator.apply(messages).at(-1)?.id).toBe('pending')
  expect(messages).toEqual(original)
})

it.each([
  {restored_cache_owner:'other/u9'}, {restored_cache_owner:'thread/u8'}, {},
  {restored_cache_owner:'thread/u9',restored_cache_hash:'c'.repeat(64),foreground_requests:1},
  {restored_cache_owner:'thread/u9',restored_cache_hash:'c'.repeat(64),active:true},
  {restored_cache_owner:'thread/u9',restored_cache_hash:'c'.repeat(64),recovery_required:true},
])('does not clone an unrelated, unbound or occupied restored cache: %j', async lane => {
  const messages: UIMessage[] = [...history(), {id:'pending',role:'user',parts:[{type:'text',text:'Next'}]}]
  const coordinator = new ContextCompaction('thread',{load:async()=>undefined,save:async()=>{throw new Error('must not save')}})
  const fetcher=vi.fn(async()=>Response.json({loaded:true,atomic_summary:lane}))
  vi.stubGlobal('fetch',fetcher)
  expect(await resumeRestoredStrataSummary('http://local/v1','m','thread',messages,messages,1000,coordinator,new AbortController().signal,{})).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps the 60% tokenizer trigger for restored cache summaries',async()=>{
  const messages: UIMessage[] = [...history(),{id:'pending',role:'user',parts:[{type:'text',text:'Next'}]}]
  const coordinator=new ContextCompaction('thread',{load:async()=>undefined,save:async()=>{throw new Error('must not save')}})
  const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('/status')
    ? {loaded:true,atomic_summary:{restored_cache_owner:'thread/u9',restored_cache_hash:await strataHistoryHash(history())}} : {input_tokens:600}))
  vi.stubGlobal('fetch',fetcher)
  expect(await resumeRestoredStrataSummary('http://local/v1','m','thread',messages,messages,1000,coordinator,new AbortController().signal,{})).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(2)
})


it('rejects an edited transcript even when the restored owner IDs still match', async () => {
  const oldHash=await strataHistoryHash(history())
  const messages: UIMessage[]=[...history(),{id:'pending',role:'user',parts:[{type:'text',text:'Next'}]}]
  messages[0].parts=[{type:'text',text:'Edited historical question'}]
  const coordinator=new ContextCompaction('thread',{load:async()=>undefined,save:async()=>{throw new Error('must not save')}})
  const fetcher=vi.fn(async()=>Response.json({loaded:true,atomic_summary:{restored_cache_owner:'thread/u9',restored_cache_hash:oldHash}}))
  vi.stubGlobal('fetch',fetcher)
  expect(await resumeRestoredStrataSummary('http://local/v1','m','thread',messages,messages,1000,coordinator,new AbortController().signal,{})).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})


it('attests the completed semantic history without transmitting dialogue text',async()=>{
  const messages=history()
  const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({saved:true}))
  vi.stubGlobal('fetch',fetcher)
  await bindStrataHistory('http://local/v1','thread/u9',messages)
  const body=JSON.parse(fetcher.mock.calls[0][1]?.body as string)
  expect(body).toEqual({owner:'thread/u9',history_hash:await strataHistoryHash(messages)})
  expect(JSON.stringify(body)).not.toContain('Question')
})

it('reports a refused history receipt instead of silently claiming persistence',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}, {status:409})))
  await expect(bindStrataHistory('http://local/v1','thread/u9',history())).rejects.toThrow('not saved (409)')
})

it('freezes the selected cache-aligned whole-turn boundary before archiving',async()=>{
 const messages=history(), saved:ArchiveRecord[]=[]
 const summarize=vi.fn(async()=> 'Aligned handoff') as unknown as Summarize
 summarize.cached=true
 summarize.selectBoundary=vi.fn(async(_messages,boundary)=>boundary-2)
 const coordinator=new ContextCompaction('thread',{load:async()=>undefined,save:async record=>{saved.push(structuredClone(record))}})
 const nominal=compactionBoundary(messages,1000)
 coordinator.schedule(messages,1000,950,summarize)
 await settle()
 expect(summarize.selectBoundary).toHaveBeenCalledWith(messages,nominal,0,expect.any(AbortSignal))
 expect(saved.at(-1)?.source).toEqual(messages.slice(0,nominal-2))
 const next:UIMessage={id:'next',role:'user',parts:[{type:'text',text:'Next question'}]}
 const view=coordinator.apply([...messages,next])
 expect(view.filter(m=>!m.id.startsWith('atomic-context-'))).toEqual([...messages.slice(nominal-2),next])
})

it('rejects a planner boundary that would discard additional recent dialogue',async()=>{
 const messages=history(),saved:ArchiveRecord[]=[]
 const summarize=vi.fn(async()=> 'Handoff') as unknown as Summarize
 summarize.cached=true;summarize.selectBoundary=vi.fn(async(_messages,boundary)=>boundary+2)
 const coordinator=new ContextCompaction('thread',{load:async()=>undefined,save:async record=>{saved.push(structuredClone(record))}})
 coordinator.schedule(messages,1000,950,summarize)
 await settle()
 expect(saved.at(-1)?.source).toEqual(messages.slice(0,compactionBoundary(messages,1000)))
})


async function readyClone() {
  const messages = history(), saved: ArchiveRecord[] = []
  const summarize: Summarize = async (_previous, _evidence, _signal, _progress, checkpoints) => {
    await checkpoints!.save({ version: 1, inputKey: 'thread/u9', offset: 1,
      completed: 1, summary: 'Frozen handoff', requests: { open: [], resolved: [] } })
    return 'Frozen handoff'
  }
  summarize.cached = true
  const coordinator = new ContextCompaction('thread', {
    load: async () => undefined, save: async record => { saved.push(structuredClone(record)) },
  })
  coordinator.schedule(messages, 1000, 950, summarize)
  await settle()
  expect(coordinator.status).toBe('ready')
  return { messages, saved, coordinator, boundary: compactionBoundary(messages, 1000) }
}

it('rechecks a finished clone after new dialogue and tool results, retaining earlier raw turns without rewriting evidence', async () => {
  const { messages, saved, coordinator, boundary } = await readyClone()
  const appended: UIMessage[] = [
    { id: 'later-user', role: 'user', parts: [{ type: 'text', text: 'Look it up' }] },
    { id: 'later-tool', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'lookup',
      toolCallId: 'lookup-1', state: 'output-available', input: { q: 'value' }, output: 'Confirmed result' }] },
    { id: 'pending', role: 'user', parts: [{ type: 'text', text: 'Next' }] },
  ]
  const live = [...messages, ...appended], original = structuredClone(live)
  const select = vi.fn(async () => boundary - 2)
  await coordinator.prepareCachedAdoption(live, select, new AbortController().signal)
  expect(select).toHaveBeenCalledWith(live, boundary, 0, expect.any(AbortSignal))
  const record = saved.at(-1)!
  expect(record.source).toEqual(messages.slice(0, boundary))
  expect(record.cacheRetainFrom).toBe(boundary - 2)
  expect(record.summary).toBe('Frozen handoff')
  const view = coordinator.apply(live)
  expect(view.filter(m => !m.id.startsWith('atomic-context-'))).toEqual(live.slice(boundary - 2))
  expect(view.findIndex(m => m.id.startsWith('atomic-context-'))).toBeGreaterThan(view.findIndex(m => m.id === 'later-tool'))
  expect(view.at(-1)?.id).toBe('pending')
  expect(live).toEqual(original)
  await coordinator.prepareCachedAdoption(live, select, new AbortController().signal)
  expect(select).toHaveBeenCalledTimes(1)
})

it.each(['later', 'fragment', 'zero', 'unchanged'] as const)('keeps the original evidence boundary on an unsafe or unchanged adoption plan: %s', async plan => {
  const { messages, saved, coordinator, boundary } = await readyClone()
  const chosen = { later: boundary + 2, fragment: boundary - 1, zero: 0, unchanged: boundary }[plan]
  await coordinator.prepareCachedAdoption(messages, async () => chosen, new AbortController().signal)
  expect(saved.at(-1)?.cacheRetainFrom).toBeUndefined()
  expect(coordinator.apply(messages).filter(m => !m.id.startsWith('atomic-context-'))).toEqual(messages.slice(boundary))
})

it('does not adopt an asynchronously planned clone after cancellation or an edit to its source', async () => {
  const { messages, saved, coordinator, boundary } = await readyClone()
  const controller = new AbortController()
  await expect(coordinator.prepareCachedAdoption(messages, async () => {
    controller.abort()
    return boundary - 2
  }, controller.signal)).rejects.toThrow()
  expect(saved.at(-1)?.cacheRetainFrom).toBeUndefined()
  const edited = structuredClone(messages)
  edited[0].parts = [{ type: 'text', text: 'Edited evidence' }]
  const select = vi.fn(async () => boundary - 2)
  await coordinator.prepareCachedAdoption(edited, select, new AbortController().signal)
  expect(select).not.toHaveBeenCalled()
})

it.each(['http://127.0.0.1:18080/v1', 'http://127.0.0.1:8010/v1'])('clones image-bearing history without replaying image bytes on %s', async baseUrl => {
  const messages = history()
  messages[0].parts.push({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,IMAGE_BYTES' })
  const pending: UIMessage = { id: 'pending', role: 'user', parts: [{ type: 'text', text: 'Next' }] }
  const coordinator = new ContextCompaction('thread', { load: async () => undefined, save: async () => {} })
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    requests.push({ url, body })
    if (url.endsWith('/status')) return Response.json({ loaded: true, atomic_summary: {
      restored_cache_owner: 'thread/u9', restored_cache_hash: await strataHistoryHash(messages),
    } })
    if (url.endsWith('/summary-token-count')) return Response.json({ input_tokens: 900 })
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      summary: 'The screenshot showed the confirmed result.', openRequests: [], resolvedRequests: [],
    }) } }] })
  }))
  expect(await resumeRestoredStrataSummary(baseUrl, 'm', 'thread', [...messages, pending], [...messages, pending],
    1000, coordinator, new AbortController().signal, {})).toBe(true)
  const task = requests.find(request => request.url.endsWith('/completions'))!.body!
  expect(task.atomic_summary_clone).toBe('thread/u9')
  expect(task.messages).toHaveLength(1)
  expect(JSON.stringify(task)).not.toContain('IMAGE_BYTES')
  expect(coordinator.apply([...messages, pending]).some(message => message.id === 'u0')).toBe(false)
})


it('waits for memory and resumes the same cached summary without replaying history', async () => {
  vi.useFakeTimers()
  try {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: 'atomic_summary_admission_refused', message: 'Summary is waiting for normal memory pressure, stable swap and available RAM; originals retained' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Ready handoff', openRequests: [], resolvedRequests: [] }) } }] }))
    vi.stubGlobal('fetch', fetcher)
    const phases: string[] = []
    const save = vi.fn(async () => {})
    const work = summarizeWithStrataCache('http://local/v1', 'm', 'thread/turn', { inputProgress: value => { if (value) phases.push(value.phase) } })('', '', new AbortController().signal, undefined, { save, requestSources: history() })
    await vi.waitFor(() => expect(phases).toContain('waiting-memory'))
    await vi.advanceTimersByTimeAsync(10001)
    expect(await work).toBe('Ready handoff')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})

it('marks urgent cached recovery without ordinary background admission', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: 'Recovered handoff', openRequests: [], resolvedRequests: [] }) } }] }))
  vi.stubGlobal('fetch', fetcher)
  const result = await summarizeWithStrataCache('http://local/v1', 'm', 'thread/turn', { recovery: true })('', '', new AbortController().signal, undefined, { save: async () => {}, requestSources: history() })
  expect(result).toBe('Recovered handoff')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ atomic_summary_clone: 'thread/turn', atomic_summary_recovery: true })
})
