import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NativeApprovalBridge } from './native-approval.mjs'

test('native approval never executes a mutation before a matching human-confirmed proposal', async () => {
  const bridge = new NativeApprovalBridge()
  let writes = 0
  let contents = 'old'
  const invoke = async () => { await bridge.request({ tool: 'os.fs.write', sessionId: 'one', category: 'fs_overwrite', preview: contents }); writes++; return { done: true } }
  const args = { path: 'synthetic', content: 'new' }
  const first = await bridge.run('os.fs.write', args, invoke)
  assert.equal(writes, 0)
  assert.equal(first.status, 'approval_required')
  assert.equal(bridge.inspect(first.pendingId).request.preview, 'old')
  await assert.rejects(bridge.run('os.fs.write', { ...args, content: 'changed' }, invoke, first.pendingId), /does not match/)
  contents = 'changed since preview'
  const stale = await bridge.run('os.fs.write', args, invoke, first.pendingId)
  assert.equal(stale.status, 'approval_required')
  assert.equal(writes, 0)
  assert.throws(() => bridge.inspect(first.pendingId), /not found/)
  assert.deepEqual(await bridge.run('os.fs.write', args, invoke, stale.pendingId), { done: true })
  assert.equal(writes, 1)
  await assert.rejects(bridge.run('os.fs.write', args, invoke, stale.pendingId), /not found/)
})

test('a failed execution consumes its matching confirmation', async () => {
  const bridge = new NativeApprovalBridge()
  const invoke = () => bridge.request({ tool: 'synthetic', category: 'synthetic' })
  const pending = await bridge.run('synthetic', {}, invoke)
  await assert.rejects(bridge.run('synthetic', {}, async () => {
    await invoke()
    throw new Error('Synthetic execution failure')
  }, pending.pendingId), /Synthetic execution failure/)
  assert.throws(() => bridge.inspect(pending.pendingId), /not found/)
})

test('expired and ownerless requests fail closed', async () => {
  let now = 0
  const bridge = new NativeApprovalBridge(() => now)
  await assert.rejects(bridge.request({ tool: 'x' }), /owns/)
  const pending = await bridge.run('x', {}, () => bridge.request({ tool: 'x', category: 'synthetic' }))
  now = 600001
  assert.throws(() => bridge.inspect(pending.pendingId), /expired/)
})
