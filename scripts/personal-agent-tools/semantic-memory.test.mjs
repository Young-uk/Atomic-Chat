import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalNotes } from './notes.mjs'
import { semanticMemory } from './semantic-memory.mjs'
import { PersonalFeatureSettings } from './feature-settings.mjs'

test('semantic settings stay disabled until explicitly configured and survive restart', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'atomic-semantic-config-'))
 try {
  const settings = new PersonalFeatureSettings(dir)
  assert.equal((await settings.get()).semanticMemory.enabled, false)
  assert.throws(() => settings.set({ version:1, semanticMemory:{ enabled:true,url:'https://example.com/v1',model:'test',dimensions:2 } }))
  await settings.set({version:1,semanticMemory:{enabled:false,url:'http://127.0.0.1:19092/v1',model:'test',dimensions:2}})
  assert.equal((await new PersonalFeatureSettings(dir).get()).semanticMemory.model,'test')
 } finally { await rm(dir,{recursive:true,force:true}) }
})
test('source-backed hybrid recall finds a meaning-only note; unavailable models fall back to keywords', async () => {
 const dir = await mkdtemp(join(tmpdir(),'atomic-semantic-test-')); const notes = new PersonalNotes(dir,dir)
 try {
  const store=notes.database()
  const a=store.store({content:'MAPLE_USER enjoys cocoa',tags:['preference'],sessionId:'synthetic-source',source:'user'})
  let available=true
  const vectorFetch=async (_url,init)=> {
   const text=JSON.parse(init.body).input
   if (!available) throw new Error('synthetic unavailable')
   return {ok:true,json:async()=>({model:'synthetic-embedding',data:[{embedding:text.includes('cocoa')||text.includes('chocolate')?[1,0]:[0,1]}]})}
  }
  semanticMemory(store,{enabled:true,url:'http://127.0.0.1:19092/v1',model:'synthetic-embedding',dimensions:2},vectorFetch)
  assert.equal(await store.writeEmbeddingFor(a.id,a.content),true)
  assert.ok((await store.recallHybridAsync('chocolate',{k:5,scope:'all'})).some(row=>row.id===a.id))
  available=false
  assert.ok((await store.recallHybridAsync('cocoa',{k:5,scope:'all'})).some(row=>row.id===a.id))
  semanticMemory(store,{enabled:false})
  assert.equal((await store.recallHybridAsync('chocolate',{k:5,scope:'all'})).length,0)
 } finally { notes.close(); await rm(dir,{recursive:true,force:true}) }
})

test('reference rewriting is opt-in, bounded to visible history and leaves legacy recall unchanged', async () => {
 const dir=await mkdtemp(join(tmpdir(),'atomic-memory-rewrite-')); const notes=new PersonalNotes(dir,dir)
 try {
  notes.database().store({content:'MAPLE_USER prefers cocoa',source:'user',sessionId:'synthetic'})
  let calls=0
  notes.queryRewriter={maybeRewrite:async()=>{calls++;return 'cocoa'}}
  const input={action:'recall',query:'what about that?',sessionId:'synthetic',history:JSON.stringify([{role:'user',text:'We discussed cocoa.'}])}
  await notes.recallWithContext(input);assert.equal(calls,0)
  notes.queryRewriteEnabled=true
  assert.ok((await notes.recallWithContext(input)).entries.some(row=>row.content.includes('cocoa')))
  assert.equal(calls,1)
  await notes.recallWithContext({...input,history:'invalid'})
  assert.equal(calls,1)
 } finally {notes.close();await rm(dir,{recursive:true,force:true})}
})
