import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersonalNotes } from './notes.mjs'
import { ReviewAgentStore } from './review-agent-store.mjs'
import { PersonalMemoryLifecycle } from './memory-lifecycle.mjs'
import { runReviewAgent } from './review-agent.mjs'
const evidence=[{id:'u',role:'user',text:'From now on verify the completed result before reporting success.',correction:true,standing:true}]
const input={sessionId:'fixture',messageId:'a1',cacheOwner:'fixture/u1',userMessage:evidence[0].text,assistantReply:'Understood.',evidence,turnCount:10,workCount:15}
const refs=[{id:'u',quote:'verify the completed result'}]
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'atomic-review-agent-'));const notes=new PersonalNotes(directory,directory);const skills=join(directory,'skills'),store=new ReviewAgentStore(notes,skills);t.after(async()=>{notes.close();await rm(directory,{recursive:true,force:true})});return {directory,notes,skills,store}}
test('memory writes are grounded, agent-authored, idempotent and reversible without deleting original notes',async t=>{
 const f=await fixture(t),id=f.store.begin(input),reads=new Map()
 const original=f.notes.call({action:'save',text:'Human note',source:'fixture'})
 await assert.rejects(f.store.tool(input,id,reads,'memory_add',{text:'Invented',evidence:[{id:'u',quote:'not in evidence'}]}),/Evidence/)
 const saved=await f.store.tool(input,id,reads,'memory_add',{text:'Verify results before reporting success.',evidence:refs})
 assert.equal(f.notes.database().get(saved.id).source,'agent')
 assert.match(f.notes.call({action:'get',id:saved.id}).sourceReference,/background-review/)
 assert.equal((await f.store.tool(input,id,reads,'memory_add',{text:'Verify results before reporting success.',evidence:refs})).id,saved.id)
 await f.store.undo(id);assert.equal(f.notes.database().get(saved.id),null);assert.equal(f.notes.database().get(original.id).content,'Human note')
})
test('skill tools require read-before-edit, refuse unrelated tools/symlinks, and undo multiple edits',async t=>{
 const f=await fixture(t),id=f.store.begin(input),reads=new Map()
 await assert.rejects(f.store.tool(input,id,reads,'shell',{command:'touch nope'}),/whitelist/)
 await f.store.tool(input,id,reads,'skill_create',{name:'verify-results',description:'Verify completed work',instructions:'Check the result before reporting success.',evidence:refs})
 reads.clear()
 await assert.rejects(f.store.tool(input,id,reads,'skill_patch',{name:'verify-results',oldText:'Check the result',newText:'Inspect the result',evidence:refs}),/Read/)
 await f.store.tool(input,id,reads,'skill_read',{name:'verify-results'})
 await f.store.tool(input,id,reads,'skill_patch',{name:'verify-results',oldText:'Check the result',newText:'Inspect the result',evidence:refs})
 assert.match(await readFile(join(f.skills,'verify-results/SKILL.md'),'utf8'),/Inspect/)
 await f.store.undo(id);await assert.rejects(readFile(join(f.skills,'verify-results/SKILL.md')),/ENOENT/)
 await mkdir(join(f.directory,'outside'));await symlink(join(f.directory,'outside'),join(f.skills,'linked-skill'))
 await assert.rejects(f.store.tool(input,id,reads,'skill_read',{name:'linked-skill'}),/Unsafe/)
})
test('observation cadence persists, counts ten user turns/fifteen tool iterations, and deduplicates retries',async t=>{
 const f=await fixture(t)
 for(let i=1;i<10;i++){const r=f.store.observe({...input,cacheOwner:'fixture/u'+i,messageId:'a'+i,turnCount:i,workCount:i});assert.equal(r.memory,false)}
 const due=f.store.observe({...input,cacheOwner:'fixture/u10',messageId:'a10',turnCount:10,workCount:15});assert.equal(due.memory,true);assert.equal(due.skills,true)
 const restarted=new ReviewAgentStore(f.notes,f.skills)
 assert.equal(restarted.observe({...input,cacheOwner:'fixture/u10'}).duplicate,true)
 assert.equal(restarted.diagnostics().observed,10)
})
test('native host callbacks execute real whitelisted tools and retain the final audit result',async t=>{
 const f=await fixture(t);let calls=0
 const fetcher=async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({atomic_auxiliary_agent:1})
  calls++;const body=JSON.parse(options.body),spec=body.atomic_auxiliary_agent
  const call=async decision=>{const response=await fetch(`http://127.0.0.1:${spec.port}/atomic-review/${spec.token}`,{method:'POST',body:JSON.stringify(decision)});assert.equal(response.status,200);return response.json()}
  const list=await call({tool:'memory_search',arguments:{query:'verify'}});assert.ok(Array.isArray(list.entries))
  await call({tool:'memory_add',arguments:{text:'Verify results before reporting success.',evidence:refs}})
  const done=await call({tool:'finish',arguments:{summary:'Saved grounded guidance.'}})
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(done)}}]})
 }
 const result=await runReviewAgent(input,f.store,{endpoint:'http://127.0.0.1:18080/v1',model:'fixture',fetcher})
 assert.equal(calls,1);assert.equal(result.changes,1);assert.equal(result.cacheMode,'resident-clone')
 assert.equal(f.notes.database().listIndex({scope:'all'}).length,1)
})
test('idle review pauses for foreground work and retries with audited status',async t=>{
 const f=await fixture(t);let calls=0
 const memory=new PersonalMemoryLifecycle({directory:f.directory,notes:f.notes,skillsRoot:f.skills,idleMs:0,complete:async()=>({content:'NONE'}),agentComplete:async(row,context)=>{
  calls++;if(calls===1)return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(Error('interrupted')),{once:true}))
  const runId=memory.agentStore.begin(row);context.onProgress({runId,tool:'finish'});return {complete:true,runId,changes:0,cacheMode:'resident-clone'}
 }})
 try{
  memory.configureReview(true);memory.enqueue(input);memory.activity(false);assert.equal(calls,1);memory.activity(true)
  for(let i=0;i<200&&memory.active;i++)await new Promise(r=>setTimeout(r,5))
  assert.equal(memory.pending.length,1);memory.activity(false)
  for(let i=0;i<200&&memory.active;i++)await new Promise(r=>setTimeout(r,5))
  assert.equal(calls,2);assert.equal(memory.status().last.state,'completed');assert.equal(memory.status().review.mode,'agent')
 }finally{await memory.close()}
})
