import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalStore } from './store.mjs'
import { CustomTools } from './custom-tools.mjs'
import { NativeApprovalBridge } from './native-approval.mjs'

const draft = { name: 'custom.echo', description: 'Synthetic echo', source: 'https://example.com/api', inputSchema: JSON.stringify({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }), code: 'return { echoed: input.text }' }
test('custom code survives restart and only executes an exact inspected approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-custom-test-'))
  let custom = new CustomTools(new PersonalStore(directory), directory)
  await custom.save(draft)
  custom = new CustomTools(new PersonalStore(directory), directory)
  assert.equal((await custom.list()).length, 1)
  const approvals = new NativeApprovalBridge()
  const pending = await custom.run(draft.name, { text: 'hello' }, approvals)
  assert.equal(pending.status, 'approval_required')
  assert.equal(approvals.inspect(pending.pendingId).request.code, draft.code)
  assert.deepEqual(await custom.run(draft.name, { text: 'hello' }, approvals, pending.pendingId), { echoed: 'hello' })
  await assert.rejects(custom.run(draft.name, { text: 'hello' }, approvals, pending.pendingId), /expired/)
  const old = await custom.run(draft.name, { text: 'hello' }, approvals)
  await custom.save({ ...draft, code: 'return "changed"' })
  await assert.rejects(custom.run(draft.name, { text: 'hello' }, approvals, old.pendingId), /does not match/)
  assert.deepEqual(await custom.remove(draft.name), { removed: true })
  await assert.rejects(custom.get(draft.name), /not found/)
})
test('malformed schemas, code and inputs never dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-custom-invalid-'))
  const runner = () => { throw new Error('must not execute') }
  const custom = new CustomTools(new PersonalStore(directory), directory, runner)
  await assert.rejects(custom.save({ ...draft, name: 'os.shell.run' }), /Custom names/)
  await assert.rejects(custom.save({ ...draft, code: 'return {' }), SyntaxError)
  await assert.rejects(custom.save({ ...draft, inputSchema: '{"type":"object","additionalProperties":false,"$ref":"x"}' }), /Unsupported/)
  await custom.save(draft)
  await assert.rejects(custom.run(draft.name, {}, new NativeApprovalBridge()), /Missing/)
  await assert.rejects(custom.run(draft.name, { text: 3 }, new NativeApprovalBridge()), /expected string/)
  await assert.rejects(custom.run(draft.name, { text: 'ok', extra: true }, new NativeApprovalBridge()), /Unexpected/)
})
test('Chat adapter discovers custom schemas and confirms the stored proposal', async () => {
  const { PersonalTools } = await import('./server.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'atomic-custom-adapter-'))
  const tools = new PersonalTools({ directory, browser: { shutdown: async () => {} } })
  try {
    await tools.call('personal_native', { action: 'register', ...draft })
    assert.ok((await tools.call('personal_native', { action: 'catalog' })).some(row => row.name === draft.name))
    assert.equal((await tools.call('personal_native', { action: 'describe', name: draft.name })).inputSchema.properties.text.type, 'string')
    const proposal = await tools.call('personal_native', { action: 'run', name: draft.name, input: '{"text":"adapter"}' })
    assert.equal(proposal.status, 'approval_required')
    const inspected = await tools.call('personal_native', { action: 'inspect', pendingId: proposal.pendingId })
    assert.equal(inspected.args.definition.code, draft.code)
    assert.deepEqual(await tools.call('personal_native', { action: 'confirm', pendingId: proposal.pendingId }), { echoed: 'adapter' })
  } finally { await tools.shutdown() }
})
test('approved execution is bounded and does not inherit connector credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-custom-limits-'))
  let captured
  const custom = new CustomTools(new PersonalStore(directory), directory, async (...args) => { captured = args; return { stdout: '{"ok":true}' } })
  await custom.save(draft)
  const approvals = new NativeApprovalBridge()
  const proposal = await custom.run(draft.name, { text: 'limits' }, approvals)
  assert.equal(captured, undefined)
  assert.deepEqual(await custom.run(draft.name, { text: 'limits' }, approvals, proposal.pendingId), { ok: true })
  assert.equal(captured[2].timeout, 30000)
  assert.equal(captured[2].maxBuffer, 256 * 1024)
  assert.deepEqual(Object.keys(captured[2].env).sort(), ['HOME','PATH','TMPDIR'])
})
test('register and update accept nested definitions without duplicating or silently replacing conflicting fields', async () => {
  const { PersonalTools } = await import('./server.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'atomic-custom-update-'))
  const tools = new PersonalTools({ directory, browser: { shutdown: async () => {} } })
  try {
    await tools.call('personal_native', { action: 'register', input: JSON.stringify(draft) })
    const pending = await tools.call('personal_native', { action: 'run', name: draft.name, input: '{"text":"old"}' })
    const changed = { ...draft, description: 'Updated echo', code: 'return { changed: input.text }' }
    await tools.call('personal_native', { action: 'update', input: JSON.stringify(changed) })
    assert.equal((await tools.call('personal_native', { action: 'describe', name: draft.name })).code, changed.code)
    assert.equal((await tools.call('personal_native', { action: 'catalog' })).filter(row => row.name === draft.name).length, 1)
    await assert.rejects(tools.call('personal_native', { action: 'confirm', pendingId: pending.pendingId }), /does not match/)
    await assert.rejects(tools.call('personal_native', { action: 'update', ...draft, name: 'custom.missing' }), /not found/)
    await assert.rejects(tools.call('personal_native', { action: 'register', name: 'custom.other', input: JSON.stringify(draft) }), /Conflicting/)
    await assert.rejects(tools.call('personal_native', { action: 'register', input: '[]' }), /JSON object/)
    await assert.rejects(tools.call('personal_native', { action: 'register', input: JSON.stringify({ ...draft, unsupported: true }) }), /Unexpected/)
    await tools.call('personal_native', { action: 'register', ...draft })
    assert.equal((await tools.call('personal_native', { action: 'describe', name: draft.name })).code, draft.code)
  } finally { await tools.shutdown() }
})
