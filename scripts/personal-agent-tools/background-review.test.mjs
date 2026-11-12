import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalNotes } from './notes.mjs'
import { ReviewStore } from './review-store.mjs'
import { PersonalMemoryLifecycle } from './memory-lifecycle.mjs'
import { validateReviewEvidence } from './review-channel.mjs'
import { completeBackground } from './background-inference.mjs'

const evidence = validateReviewEvidence([{ id:'user',role:'user',text:'From now on always keep answers concise.' }])
const input = id => ({ sessionId:'synthetic-review',messageId:id,userMessage:evidence[0].text,assistantReply:'I will keep answers concise.',cacheOwner:'synthetic-review/user',evidence })
const proposal = principle => ({ kind:'correction',scope:'standing',activation:'Response style',principle,evidence:[{id:'user',quote:'always keep answers concise'}],steps:[] })
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(),'atomic-review-'))
  const notes = new PersonalNotes(directory,directory)
  return { directory,notes,store:new ReviewStore(notes) }
}
const settled = async memory => {
  for (let i=0;i<300;i++) { if (!memory.active && !memory.pending.length) return; await new Promise(resolve=>setTimeout(resolve,5)) }
  throw new Error('Review did not settle')
}
test('grounded changes are versioned, deduplicated, recalled and undone without deleting original notes', async () => {
  const {notes,store}=await setup()
  try {
    const original=notes.call({action:'save',text:'Original release note',source:'synthetic'})
    const first=store.apply(input('one'),[proposal('Keep answers concise.')])
    assert.equal(store.apply(input('one'),[proposal('Keep answers concise.')]).duplicate,true)
    assert.equal(store.apply(input('two'),[proposal('Keep answers concise.')]).changes.length,0)
    const second=store.apply(input('three'),[proposal('Use concise answers with useful evidence.')])
    assert.match(store.context('hello')[0].content,/useful evidence/)
    assert.throws(()=>store.undo(first.id),/newer related/)
    store.undo(second.id)
    assert.match(store.context('hello')[0].content,/Keep answers concise/)
    store.undo(first.id)
    assert.equal(store.context('hello').length,0)
    assert.equal(notes.database().get(original.id).content,'Original release note')
    assert.equal(store.history().length,2)
  } finally { notes.close() }
})
test('all proposals validate before writes: no assistant-only claims, invented quotes, duplicate keys or secrets',async()=>{
  const {notes,store}=await setup()
  try {
    const p=proposal('Keep answers concise.')
    assert.throws(()=>store.apply(input('bad'),[p,{...p,evidence:[{id:'user',quote:'invented evidence'}]}]),/evidence/)
    assert.throws(()=>store.apply(input('duplicate'),[p,p]),/Duplicate/)
    assert.throws(()=>store.apply({...input('assistant'),evidence:validateReviewEvidence([{id:'user',role:'assistant',text:evidence[0].text}])},[p]),/observed user/)
    assert.throws(()=>store.apply(input('secret'),[proposal('password=private123')]),/Invalid/)
    assert.equal(store.history().length,0)
  } finally { notes.close() }
})
test('procedures require successful tool evidence for every step and are recalled only when relevant',async()=>{
  const {notes,store}=await setup()
  const procedure={kind:'procedure',scope:'contextual',activation:'release',principle:'Verify release before publication.',evidence:[{id:'tool',quote:'build passed'}],steps:[{text:'Build the release.',evidenceId:'tool',quote:'build passed'},{text:'Verify signature.',evidenceId:'tool',quote:'signature valid'}]}
  const row={...input('procedure'),evidence:validateReviewEvidence([{id:'tool',role:'tool',verified:true,text:'build passed; signature valid'}])}
  try {
    assert.throws(()=>store.apply({...row,evidence:row.evidence.map(e=>({...e,verified:false}))},[procedure]),/successful tool/)
    store.apply(row,[procedure])
    assert.equal(store.context('gardening').length,0)
    assert.equal(store.context('release').length,1)
    assert.ok(notes.call({action:'recall',query:'release'}).entries.some(e=>e.id.startsWith('review:')))
  } finally { notes.close() }
})
test('review shares one inference with memory formation and interrupts for foreground conversation',async()=>{
  const {directory,notes}=await setup()
  let calls=0
  const memory=new PersonalMemoryLifecycle({directory,notes,complete:async params=>{
    calls++
    assert.equal(params.cacheOwner,'synthetic-review/user')
    assert.equal(params.reviewChannel,true)
    if(calls===1)return new Promise((resolve,reject)=>params.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    return {content:JSON.stringify({lines:'NONE',lessons:[proposal('Keep answers concise.')]})}
  }})
  try {
    memory.configureReview(true);memory.enqueue(input('one'));memory.activity(false)
    assert.equal(calls,1)
    memory.activity(true)
    for(let i=0;i<200&&memory.active;i++)await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(memory.reviewHistory().length,0)
    assert.equal(memory.pending.length,1)
    memory.activity(false);await settled(memory)
    assert.equal(calls,2)
    assert.equal(memory.reviewHistory().length,1)
    assert.equal(memory.reviewHistory()[0].messageId,'one')
  } finally { await memory.close();notes.close() }
})
test('native clone uses private JSON channel, falls back only for recognized clone rejection and never saves partial generation',async()=>{
  const requests=[]
  const fetcher=async(_url,params)=>{
    requests.push(JSON.parse(params.body))
    if(requests.length===1)return new Response(JSON.stringify({error:{code:'atomic_summary_clone_stale'}}),{status:409})
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"lines":"NONE","lessons":[]}'}}]}))
  }
  await completeBackground({prompt:'synthetic',cacheOwner:'owner',reviewChannel:true},{endpoint:'http://127.0.0.1:18080/v1',model:'synthetic',fetcher})
  assert.equal(requests[0].atomic_summary_clone,'owner');assert.equal(requests[0].atomic_auxiliary,true)
  assert.equal(requests[0].max_tokens,0);assert.equal(requests[1].atomic_summary_clone,undefined)
  assert.equal(requests[0].tools,undefined)
  await assert.rejects(completeBackground({prompt:'synthetic'},{endpoint:'http://localhost/v1',model:'synthetic',fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'partial'}}]}))}),/did not complete/)
})
test('original memory output emitter is adapted to native JSON without unsupported general tool calls',async()=>{
  let body
  const result=await completeBackground({prompt:'extract',tools:[{type:'function',function:{name:'emit_reflection',parameters:{type:'object',properties:{lines:{type:'string'}}}}}]},{endpoint:'http://127.0.0.1:18080/v1',model:'synthetic',fetcher:async(_url,p)=>{
    body=JSON.parse(p.body)
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"lines":"NONE"}'}}]}))
  }})
  assert.equal(body.tools,undefined)
  assert.equal(body.response_format.type,'json_schema')
  assert.equal(JSON.parse(result.toolCalls[0].function.arguments).lines,'NONE')
})
