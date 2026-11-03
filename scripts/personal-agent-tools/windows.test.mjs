import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowCall } from './windows.mjs'

test('denied Accessibility prompts once and never executes window operations', { skip: process.platform !== 'darwin' }, async () => {
  const prompts = []
  const runner = async (_, argv) => {
    assert.match(argv[3], /AXIsProcessTrusted/)
    prompts.push(JSON.parse(argv[4]).prompt)
    return { stdout: '{"granted":false}' }
  }
  for (const action of ['list', 'list', 'permissions', 'request_permission']) {
    const result = await windowCall({ action }, runner)
    assert.equal(result.code, 'accessibility_permission_required')
    assert.equal(result.retryable, false)
    assert.equal(result.performed, false)
    assert.match(result.settingsUrl, /Privacy_Accessibility/)
  }
  assert.deepEqual(prompts, [true, false, false, true])
})

test('granted access proceeds and revocation produces actionable permission state', { skip: process.platform !== 'darwin' }, async () => {
  let calls = 0
  const result = await windowCall({ action: 'list' }, async (_, argv) => {
    calls++
    return { stdout: argv[3].includes('AXIsProcessTrusted') ? '{"granted":true}' : '[{"app":"Synthetic"}]' }
  })
  assert.equal(calls, 2)
  assert.equal(result[0].app, 'Synthetic')
  const revoked = await windowCall({ action: 'list' }, async (_, argv) => {
    if (argv[3].includes('AXIsProcessTrusted')) return { stdout: '{"granted":true}' }
    throw Object.assign(new Error('permission revoked'), { stderr: 'accessibility denied (-25211)' })
  })
  assert.equal(revoked.retryable, false)
  assert.equal(revoked.performed, false)
})
