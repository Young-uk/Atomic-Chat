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

test('restore validates the selected window and unminimizes before raising', { skip: process.platform !== 'darwin' }, async () => {
  await assert.rejects(windowCall({ action: 'restore', app: 'Synthetic', index: 0 }), /window index/)
  const result = await windowCall({ action: 'restore', app: 'Synthetic', index: 1 }, async (_, argv) => {
    if (argv[3].includes('AXIsProcessTrusted')) return { stdout: '{"granted":true}' }
    assert.deepEqual(JSON.parse(argv[4]), { action: 'restore', app: 'Synthetic', index: 1 })
    assert.match(argv[3], /action === 'restore'.*AXMinimized.*value=false; p.frontmost=true; w.actions.byName\('AXRaise'\)/)
    return { stdout: '{"app":"Synthetic","index":1,"action":"restore"}' }
  })
  assert.equal(result.action, 'restore')
})

test('window script reports observed minimized states and reads back minimize/restore', { skip: process.platform !== 'darwin' }, async () => {
  const { runInNewContext } = await import('node:vm')
  let state = false
  let readable = true
  const window = {
    name: () => 'Synthetic', position: () => [0, 0], size: () => [800, 600],
    attributes: { byName: () => Object.defineProperty({}, 'value', {
      get: () => () => { if (!readable) throw Error('unavailable'); return state },
      set: value => { state = value },
    }) },
    actions: { byName: () => ({ perform() {} }) },
  }
  const process = { name: () => 'Synthetic', windows: () => [window] }
  const runner = async (_, argv) => {
    if (argv[3].includes('AXIsProcessTrusted')) return { stdout: '{"granted":true}' }
    return { stdout: runInNewContext(`${argv[3]}; run(args)`, {
      args: [argv[4]], Application: () => ({ applicationProcesses: { whose: () => () => [process] } }),
    }) }
  }
  assert.equal((await windowCall({ action: 'list' }, runner))[0].windows[0].minimized, false)
  assert.equal((await windowCall({ action: 'minimize', app: 'Synthetic', index: 1 }, runner)).minimized, true)
  assert.equal((await windowCall({ action: 'list' }, runner))[0].windows[0].minimized, true)
  assert.equal((await windowCall({ action: 'restore', app: 'Synthetic', index: 1 }, runner)).minimized, false)
  readable = false
  assert.equal((await windowCall({ action: 'list' }, runner))[0].windows[0].minimized, 'unknown')
})
