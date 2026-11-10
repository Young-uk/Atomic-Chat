import { beginDstarForeground, noteDstarCacheOwner } from '../dstar-summary-idle'
import { SummaryHeadroomError, SummaryOutputLimitError } from '../summary-stream'
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
  expect(body.max_tokens).toBe(0)
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

it('switches blocked recovery to bounded complete turns only for explicit headroom refusal', async () => {
  const messages: UIMessage[] = [...history(), { id:'pending', role:'user', parts:[{type:'text',text:'Keep newest question'}] }]
  const original = structuredClone(messages), saved: ArchiveRecord[] = []
  const counts: number[] = []
  const fallback = vi.fn(async (_previous, _evidence, _signal, _progress, checkpoints) => {
    const segment = checkpoints?.requestSources ?? []
    counts.push(segment.length)
    await checkpoints?.save({version:1,inputKey:'cold',offset:segment.length,completed:1,summary:'Emergency handoff',requests:{open:[],resolved:[]}})
    return 'Emergency handoff'
  }) as unknown as Summarize
  fallback.recoveryPriority = true
  fallback.batches = { selectCompletePrefix:async source => Math.min(4, source.length), consolidate:async batches => batches }
  const clone = vi.fn(async () => { throw new SummaryHeadroomError() }) as unknown as Summarize
  clone.cached = true; clone.recoveryPriority = true; clone.headroomFallback = fallback
  const coordinator = new ContextCompaction('thread', {save:async record=>{saved.push(structuredClone(record))},load:async()=>undefined})
  await coordinator.recover(messages, 1000, clone, undefined, 0,
    view => view.some(message => message.id.startsWith('atomic-context-')) ? 900 : 1100)
  expect(clone).toHaveBeenCalledTimes(1)
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(counts).toEqual([4])
  const view = coordinator.apply(messages)
  expect(view.at(-1)?.id).toBe('pending')
  expect(messages).toEqual(original)
  expect(saved.some(record => record.summary === 'Historical segment 1:\nEmergency handoff')).toBe(true)
})

it('does not switch strategy for stale caches or arbitrary summary failures', async () => {
  const messages: UIMessage[] = [...history(), {id:'pending',role:'user',parts:[{type:'text',text:'Newest'}]}]
  const fallback = vi.fn(async ()=>'not allowed') as unknown as Summarize
  const clone = vi.fn(async () => {throw new Error('Cache changed; originals retained')}) as unknown as Summarize
  clone.cached = true; clone.recoveryPriority = true; clone.headroomFallback = fallback
  const coordinator = new ContextCompaction('thread',{save:async()=>{},load:async()=>undefined})
  await expect(coordinator.recover(messages,1000,clone)).rejects.toThrow('Cache changed')
  expect(fallback).not.toHaveBeenCalled()
})

it('prepares token-counted emergency requests without cloning the full native history', async () => {
  const calls: Record<string, unknown>[] = []
  vi.stubGlobal('fetch',vi.fn(async (url:string,init?:RequestInit)=>{
    const body=JSON.parse(init?.body as string);calls.push(body)
    if(url.endsWith('summary-token-count')) return Response.json({input_tokens:100,context_length:16384})
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Bounded summary',openRequests:[],resolvedRequests:[]})}}]})
  }))
  const clone=summarizeWithStrataCache('http://local/v1','m','thread/turn',{recovery:true,coldRecovery:true})
  const fallback=clone.headroomFallback!
  await fallback('', '', new AbortController().signal,undefined,{save:async()=>{},requestSources:history().slice(0,2)})
  const generated=calls.find(body=>body.atomic_summary_cold_recovery)
  expect(generated).toMatchObject({atomic_summary_recovery:true,atomic_summary_cold_recovery:'thread/turn',temperature:1})
  expect(generated).not.toHaveProperty('atomic_summary_clone')
  expect(calls.length).toBeGreaterThan(1)
})

it('automatically continues a normal background capacity failure without adopting or rewriting messages', async () => {
  const messages = history(), original = structuredClone(messages), saved: ArchiveRecord[] = []
  const completed = vi.fn(async (_previous, _evidence, _signal, _progress, checkpoints) => {
    await checkpoints?.save({version:1,inputKey:'background-cold',offset:4,completed:1,summary:'Verified older facts',requests:{open:[],resolved:[]}})
    return 'Verified older facts'
  }) as unknown as Summarize
  completed.batches = {countRawTokens:async source=>source.length*50,selectCompletePrefix:async source=>Math.min(4,source.length),consolidate:async batches=>batches}
  completed.fallbackReason='headroom'
  const clone=vi.fn(async()=>{throw new SummaryHeadroomError()}) as unknown as Summarize
  clone.cached=true;clone.headroomFallback=completed
  const changes: import('../context-summary-progress').SummaryProgress[]=[]
  const coordinator=new ContextCompaction('thread',{save:async record=>{saved.push(structuredClone(record))},load:async()=>undefined},value=>{if(value)changes.push(value)})
  coordinator.schedule(messages,1000,950,clone,undefined,view=>view.some(m=>m.id.startsWith('atomic-context-'))?500:950)
  await settle();await settle();await settle()
  expect(clone).toHaveBeenCalledTimes(1)
  expect(completed).toHaveBeenCalledTimes(2)
  expect(coordinator.error).toBeUndefined()
  expect(changes.some(value=>value.phase==='failed')).toBe(false)
  expect(changes.some(value=>value.method==='segments'&&value.fallbackReason==='headroom')).toBe(true)
  expect(changes.at(-1)?.phase).toBe('ready')
  const newer: UIMessage={id:'new-after-snapshot',role:'user',parts:[{type:'text',text:'Keep this new question'}]}
  const view=coordinator.apply([...messages,newer])
  expect(view.at(-1)?.id).toBe(newer.id)
  expect(messages).toEqual(original)
  expect(saved.filter(record=>record.summary).at(-1)?.source).toEqual(original.slice(0,8))
})

it('waits for conversation completion then preserves the latest native owner with frozen older evidence', async () => {
  const endpoint='http://background-owner/v1', end=beginDstarForeground(endpoint)
  noteDstarCacheOwner(endpoint,'thread/old')
  const generated: Record<string,unknown>[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/status'))return Response.json({atomic_summary:{foreground_requests:0}})
    const body=JSON.parse(init?.body as string)
    if(url.endsWith('summary-token-count'))return Response.json({input_tokens:100,context_length:16384})
    generated.push(body)
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Frozen facts',openRequests:[],resolvedRequests:[]})}}]})
  }))
  const fallback=summarizeWithStrataCache(endpoint,'m','thread/old',{coldRecovery:true}).headroomFallback!
  const source=history().slice(0,2), original=structuredClone(source)
  const task=fallback('','',new AbortController().signal,undefined,{save:async()=>{},requestSources:source})
  await settle();expect(generated).toHaveLength(0)
  noteDstarCacheOwner(endpoint,'thread/new');end()
  expect(await task).toBe('Frozen facts')
  expect(generated).toHaveLength(1)
  expect(generated[0]).toMatchObject({atomic_summary_cold_recovery:'thread/new',atomic_summary_recovery:true})
  expect(source).toEqual(original)
  expect(JSON.stringify(generated[0])).not.toContain('new-after-snapshot')
})

it('retries only a clean native idle race and refreshes the preserved owner', async () => {
  const endpoint='http://idle-race/v1';noteDstarCacheOwner(endpoint,'thread/old')
  const requests: Record<string,unknown>[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/status'))return Response.json({atomic_summary:{foreground_requests:0}})
    const body=JSON.parse(init?.body as string)
    if(url.endsWith('summary-token-count'))return Response.json({input_tokens:100,context_length:16384})
    requests.push(body)
    if(requests.length===1){
      noteDstarCacheOwner(endpoint,'thread/new')
      return Response.json({error:{code:'atomic_summary_admission_refused',message:'Recovery is waiting for the active conversation to finish; originals retained'}},{status:409})
    }
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Independent facts',openRequests:[],resolvedRequests:[]})}}]})
  }))
  const fallback=summarizeWithStrataCache(endpoint,'m','thread/old',{coldRecovery:true}).headroomFallback!
  expect(await fallback('','',new AbortController().signal,undefined,{save:async()=>{},requestSources:history().slice(0,2)})).toBe('Independent facts')
  expect(requests.map(body=>body.atomic_summary_cold_recovery)).toEqual(['thread/old','thread/new'])
})

it('promotes an idle background fallback without leaving its old completion in control', async () => {
  const source=history(), saved: ArchiveRecord[]=[]
  let waitingSignal: AbortSignal | undefined
  const cold=vi.fn(async(_previous,_evidence,signal:AbortSignal)=>{
    waitingSignal=signal
    return await new Promise<string>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  }) as unknown as Summarize
  cold.batches={countRawTokens:async view=>view.length*50,selectCompletePrefix:async()=>4,consolidate:async batches=>batches}
  const clone=vi.fn(async()=>{throw new SummaryHeadroomError()}) as unknown as Summarize
  clone.cached=true;clone.headroomFallback=cold
  const coordinator=new ContextCompaction('thread',{save:async record=>{saved.push(structuredClone(record))},load:async()=>undefined})
  coordinator.schedule(source,1000,950,clone)
  await settle();await settle()
  expect(waitingSignal).toBeDefined()
  const urgent=vi.fn(async(_previous,_evidence,_signal,_progress,checkpoints)=>{
    await checkpoints?.save({version:1,inputKey:'urgent',offset:4,completed:1,summary:'Urgent verified facts',requests:{open:[],resolved:[]}})
    return 'Urgent verified facts'
  }) as unknown as Summarize
  urgent.cached=true;urgent.recoveryPriority=true
  const latest: UIMessage={id:'pending-latest',role:'user',parts:[{type:'text',text:'New question'}]}
  await coordinator.recover([...source,latest],1000,urgent,undefined,0,view=>view.some(m=>m.id.startsWith('atomic-context-'))?500:1100)
  expect(waitingSignal?.aborted).toBe(true)
  expect(urgent).toHaveBeenCalledTimes(1)
  expect(coordinator.error).toBeUndefined()
  expect(coordinator.apply([...source,latest]).at(-1)?.id).toBe(latest.id)
})

it('does not idle-wait on the foreground request that depends on restored-cache recovery', async () => {
  const endpoint='http://startup-capacity/v1', end=beginDstarForeground(endpoint)
  const messages: UIMessage[]=[...history(),{id:'pending',role:'user',parts:[{type:'text',text:'Newest question'}]}]
  const generated: Record<string,unknown>[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/status'))return Response.json({loaded:true,atomic_summary:{restored_cache_owner:'thread/u9',restored_cache_hash:await strataHistoryHash(history())}})
    const body=JSON.parse(init?.body as string)
    if(url.endsWith('summary-token-count'))return Response.json({input_tokens:900,context_length:16384})
    generated.push(body)
    if(body.atomic_summary_clone)return Response.json({error:{code:'atomic_summary_headroom_exhausted'}},{status:409})
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Recovered startup facts',openRequests:[],resolvedRequests:[]})}}]})
  }))
  const coordinator=new ContextCompaction('thread',{save:async()=>{},load:async()=>undefined})
  try {
    expect(await resumeRestoredStrataSummary(endpoint,'m','thread',messages,messages,1000,coordinator,new AbortController().signal,{coldRecovery:true})).toBe(true)
    expect(generated[0]).toMatchObject({atomic_summary_clone:'thread/u9',atomic_summary_recovery:true})
    expect(generated[1]).toMatchObject({atomic_summary_cold_recovery:'thread/u9',atomic_summary_recovery:true})
    expect(coordinator.apply(messages).at(-1)?.id).toBe('pending')
  } finally {end()}
})

it('keeps native foreground priority for the independent Dstar background slot', async () => {
  const generated: Record<string,unknown>[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const body=JSON.parse(init?.body as string)
    if(url.endsWith('summary-token-count'))return Response.json({input_tokens:100,context_length:16384})
    generated.push(body)
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'Dstar background facts',openRequests:[],resolvedRequests:[]})}}]})
  }))
  const fallback=summarizeWithStrataCache('http://dstar-background/v1','m','thread/turn',{}).headroomFallback!
  expect(await fallback('','',new AbortController().signal,undefined,{save:async()=>{},requestSources:history().slice(0,2)})).toBe('Dstar background facts')
  expect(generated[0]).not.toHaveProperty('atomic_summary_recovery')
  expect(generated[0]).not.toHaveProperty('atomic_summary_cold_recovery')
  expect(fallback.recoveryPriority).toBe(false)
})

it('recovers a length-limited clone using complete turns while preserving the newest request', async () => {
  const messages: UIMessage[] = [...history(), { id:'pending', role:'user', parts:[{type:'text',text:'Keep newest question'}] }]
  const original = structuredClone(messages), saved: ArchiveRecord[] = []
  const counts: number[] = []
  const fallback = vi.fn(async (_previous, _evidence, _signal, _progress, checkpoints) => {
    const segment = checkpoints?.requestSources ?? []
    counts.push(segment.length)
    await checkpoints?.save({version:1,inputKey:'cold',offset:segment.length,completed:1,summary:'Emergency handoff',requests:{open:[],resolved:[]}})
    return 'Emergency handoff'
  }) as unknown as Summarize
  fallback.recoveryPriority = true
  fallback.batches = { selectCompletePrefix:async source => Math.min(4, source.length), consolidate:async batches => batches }
  const clone = vi.fn(async () => { throw new SummaryOutputLimitError() }) as unknown as Summarize
  clone.cached = true; clone.recoveryPriority = true; clone.outputLimitFallback = fallback
  const coordinator = new ContextCompaction('thread', {save:async record=>{saved.push(structuredClone(record))},load:async()=>undefined})
  await coordinator.recover(messages, 1000, clone, undefined, 0,
    view => view.some(message => message.id.startsWith('atomic-context-')) ? 900 : 1100)
  expect(clone).toHaveBeenCalledTimes(1)
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(counts).toEqual([4])
  const view = coordinator.apply(messages)
  expect(view.at(-1)?.id).toBe('pending')
  expect(messages).toEqual(original)
  expect(saved.some(record => record.summary === 'Historical segment 1:\nEmergency handoff')).toBe(true)
})


it('continues a length-limited background clone without committing its partial output', async () => {
  const messages = history(), original = structuredClone(messages), saved: ArchiveRecord[] = []
  const completed = vi.fn(async (_previous, _evidence, _signal, _progress, checkpoints) => {
    await checkpoints?.save({version:1,inputKey:'background-cold',offset:4,completed:1,summary:'Verified older facts',requests:{open:[],resolved:[]}})
    return 'Verified older facts'
  }) as unknown as Summarize
  completed.batches = {countRawTokens:async source=>source.length*50,selectCompletePrefix:async source=>Math.min(4,source.length),consolidate:async batches=>batches}
  completed.fallbackReason='output_limit'
  const clone=vi.fn(async()=>{throw new SummaryOutputLimitError()}) as unknown as Summarize
  clone.cached=true;clone.outputLimitFallback=completed
  const changes: import('../context-summary-progress').SummaryProgress[]=[]
  const coordinator=new ContextCompaction('thread',{save:async record=>{saved.push(structuredClone(record))},load:async()=>undefined},value=>{if(value)changes.push(value)})
  coordinator.schedule(messages,1000,950,clone,undefined,view=>view.some(m=>m.id.startsWith('atomic-context-'))?500:950)
  await settle();await settle();await settle()
  expect(clone).toHaveBeenCalledTimes(1)
  expect(completed).toHaveBeenCalledTimes(2)
  expect(coordinator.error).toBeUndefined()
  expect(changes.some(value=>value.phase==='failed')).toBe(false)
  expect(changes.some(value=>value.method==='segments'&&value.fallbackReason==='output_limit')).toBe(true)
  expect(changes.at(-1)?.phase).toBe('ready')
  const newer: UIMessage={id:'new-after-snapshot',role:'user',parts:[{type:'text',text:'Keep this new question'}]}
  const view=coordinator.apply([...messages,newer])
  expect(view.at(-1)?.id).toBe(newer.id)
  expect(messages).toEqual(original)
  expect(saved.filter(record=>record.summary).at(-1)?.source).toEqual(original.slice(0,8))
})


it('rejects even parseable length-limited JSON before any checkpoint is saved', async () => {
  const save = vi.fn(async () => {})
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify({summary:'Incomplete handoff',openRequests:[],resolvedRequests:[]})}}]})))
  const adapter = summarizeWithStrataCache('http://length-test/v1','m','thread/turn',{})
  await expect(adapter('', '', new AbortController().signal, undefined, {save,requestSources:history()})).rejects.toBeInstanceOf(SummaryOutputLimitError)
  expect(save).not.toHaveBeenCalled()
  expect(adapter.outputLimitFallback?.fallbackReason).toBe('output_limit')
})

it('accepts a completed clone result beyond the prose target without slicing it', async () => {
  const prose = 'Confirmed fact. '.repeat(500), save = vi.fn(async () => {})
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:prose,openRequests:[],resolvedRequests:[]})}}]})))
  await expect(summarizeWithStrataCache('http://room-test/v1','m','thread/turn',{})('', '',new AbortController().signal,undefined,{save,requestSources:history()})).resolves.toBe(prose.trim())
  expect(save).toHaveBeenCalledTimes(1)
})
