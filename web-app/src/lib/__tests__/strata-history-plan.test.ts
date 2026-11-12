import { afterEach, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { historyPlanMessages, planStrataHistoryBoundary } from '../strata-history-plan'
vi.mock('../dstar-context-archive', () => ({fetchDstarContext:(...args:Parameters<typeof fetch>)=>fetch(...args)}))
afterEach(()=>vi.unstubAllGlobals())
const history: UIMessage[] = Array.from({length:10},(_,i)=>({id:`m${i}`,role:i%2===0?'user':'assistant',parts:[{type:'text',text:`Message ${i}`}]}))
it('uses the SDK wire serializer for text, reasoning and tool results',()=>{
 const wire=historyPlanMessages([{role:'system',content:'Instructions'},{role:'user',content:'Question'},
  {role:'assistant',content:[{type:'reasoning',text:'Thinking'},{type:'tool-call',toolCallId:'call',toolName:'lookup',input:{q:'value'}}]},
  {role:'tool',content:[{type:'tool-result',toolCallId:'call',toolName:'lookup',output:{type:'json',value:{ok:true}}}]}])
 expect(wire[0]).toEqual({role:'system',content:'Instructions'})
 expect(wire[1]).toEqual({role:'user',content:'Question'})
 expect(wire[2]).toMatchObject({role:'assistant',reasoning_content:'Thinking',tool_calls:[{id:'call',function:{name:'lookup',arguments:'{"q":"value"}'}}]})
 expect(wire[3]).toEqual({role:'tool',tool_call_id:'call',content:'{"ok":true}'})
})
it('plans only the nominal boundary and earlier complete turns after the active archive',async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({boundary:6,reason:'aligned',retained_tokens:2000}))
 vi.stubGlobal('fetch',fetcher)
 const chosen=await planStrataHistoryBoundary('http://local/v1','model','thread/turn',history,8,2,new AbortController().signal,
  retained=>retained.map(m=>({role:m.role,content:m.id})),{tools:[]})
 expect(chosen).toBe(6)
 const body=JSON.parse(fetcher.mock.calls[0][1]?.body as string)
 expect(body.candidates.map((c:{boundary:number})=>c.boundary)).toEqual([8,6,4])
 expect(body.candidates[1].messages[0].content).toBe('m6')
 expect(body.owner).toBe('thread/turn')
})
it.each([null,10,1])('ignores an unoffered or absent server boundary: %s',async boundary=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({boundary,reason:'aligned'})))
 expect(await planStrataHistoryBoundary('http://local/v1','model','thread/turn',history,8,2,new AbortController().signal,()=>[],{})).toBe(8)
})
it('keeps the existing boundary when a server cannot plan',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}, {status:404})))
 expect(await planStrataHistoryBoundary('http://local/v1','model','thread/turn',history,8,2,new AbortController().signal,()=>[],{})).toBe(8)
})

it('requires a positive cache match before changing a restored historical view', async () => {
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({reason:'cache-unavailable'})))
 expect(await planStrataHistoryBoundary('http://local/v1','model','thread/turn',history,8,2,new AbortController().signal,()=>[],{},true)).toBe(-1)
})


it('defers a background clone if foreground work changed the cache owner', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ reason: 'cache-changed' })))
  await expect(planStrataHistoryBoundary('http://local/v1', 'model', 'thread/old-turn', history, 8, 2,
    new AbortController().signal, () => [], {})).rejects.toThrow(/cache changed/i)
  // Startup adoption remains a read-only best effort, not a failed summary.
  expect(await planStrataHistoryBoundary('http://local/v1', 'model', 'thread/old-turn', history, 8, 2,
    new AbortController().signal, () => [], {}, true)).toBe(-1)
})
