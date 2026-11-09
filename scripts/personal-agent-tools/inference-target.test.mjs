import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTarget, threadTarget, validateTarget } from './inference-target.mjs'
const target = { endpoint: 'http://127.0.0.1:18080/v1', model: 'ista-iq3-xxs' }
const catalog = ids => ({ ok: true, json: async () => ({ atomic_summary_slot: true, data: ids.map(id => ({ id })) }) })
test('persisted Strata route never attempts offline Dstar or silently switches model', async () => {
 const seen=[]
 assert.deepEqual(await resolveTarget({ target, fetcher: async url => { seen.push(url); return catalog([target.model]) } }), target)
 assert.deepEqual(seen, [target.endpoint+'/models'])
 await assert.rejects(resolveTarget({ target, fetcher: async () => catalog(['other']) }), /Selected model/)
})
test('memory uses the only available background engine and rejects ambiguous engines', async () => {
 const opts={endpoint:'http://127.0.0.1:8010/v1',model:'qwen',fetcher:async url=>{if(url.includes(':8010'))throw new Error('ECONNREFUSED');return catalog([target.model])}}
 assert.deepEqual(await resolveTarget(opts),target)
 await assert.rejects(resolveTarget({...opts,fetcher:async()=>catalog(['model'])}),/Multiple/)
})
test('origin route is captured from matching application scope, not older engine or message text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'atomic-route-'))
 try {
 const dir=join(root,'threads','thread');await mkdir(dir,{recursive:true})
 await writeFile(join(dir,'thread.json'),JSON.stringify({model:{id:target.model,provider:'Strata'}}))
 await writeFile(join(dir,'messages.jsonl'),JSON.stringify({metadata:{contextUsageScope:JSON.stringify(['Strata',target.endpoint,target.model])}})+'\n')
 assert.deepEqual(await threadTarget(join(root,'agent-workspace'),'thread'),target)
 await assert.rejects(threadTarget(root,'../escape'),/Invalid/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('unattended inference cannot target external hosts, credentials, or another service',()=>{
 for(const endpoint of ['https://example.com/v1','http://127.0.0.1:9999/v1','http://x:y@127.0.0.1:18080/v1'])assert.throws(()=>validateTarget({...target,endpoint}))
})

test('saved Dstar tasks keep Dstar even when Strata is available', async () => {
 const dstar={ endpoint:'http://127.0.0.1:8010/v1',model:'qwen3.8-flash-next-chat' }
 const seen=[]
 assert.deepEqual(await resolveTarget({target:dstar,fetcher:async url=>{seen.push(url);return catalog([dstar.model])}}),dstar)
 assert.deepEqual(seen,[dstar.endpoint+'/models'])
 await assert.rejects(resolveTarget({target:dstar,fetcher:async()=>{throw new Error('connection refused')}}),/Scheduled model unavailable.*8010/)
})
