import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalNativeSuite } from './native-suite.mjs'

test('direct native tools discover schemas and retain source mutation approvals', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'atomic-native-test-'))
  const suite = new PersonalNativeSuite({ workspace, directory: workspace })
  try {
    assert.ok(suite.catalog().length > 30)
    await writeFile(join(workspace, 'sample.txt'), 'original')
    const read = await suite.run('os.fs.read', { path: 'sample.txt' })
    assert.match(JSON.stringify(read), /original/)
    await assert.rejects(suite.run('os.fs.read', { path: 'sample.txt', unexpected: true }), /unexpected/i)
    const args = { path: 'new.txt', content: 'synthetic content' }
    const pending = await suite.run('os.fs.write', args)
    assert.equal(pending.status, 'approval_required')
    await assert.rejects(readFile(join(workspace, 'new.txt')), { code: 'ENOENT' })
    assert.equal(suite.inspect(pending.pendingId).name, 'os.fs.write')
    await suite.run('os.fs.write', args, pending.pendingId)
    assert.equal(await readFile(join(workspace, 'new.txt'), 'utf8'), 'synthetic content')
  } finally { suite.close() }
})

test('outside reads ask, malformed calls do not dispatch, and shell jobs are not falsely advertised as running', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'atomic-native-boundary-'))
  const suite = new PersonalNativeSuite({ workspace, directory: workspace })
  try {
    // Upstream intentionally permits scratch roots. Use a nonexistent path
    // outside them to test the guard without touching any user file.
    const path = '/__atomic_native_synthetic_outside__/missing.txt'
    const pending = await suite.run('os.fs.read', { path })
    assert.equal(pending.status, 'approval_required')
    assert.equal(pending.category, 'fs_read_outside')
    const missing = await suite.run('os.fs.read', { path }, pending.pendingId)
    assert.equal(missing.status, 'error')
    assert.match(JSON.stringify(missing), /ENOENT|not found|does not exist/i)
    await assert.rejects(suite.run('os.fs.read', { path: '<|im_start|>' }), /control markers/)
    await assert.rejects(suite.run('os.shell.run', { cmd: 'echo', background: true }), /session lifecycle/)
    await assert.rejects(suite.run('os.shell.run', { cmd: 'echo', timeoutMs: 0 }), /timeoutMs/)
  } finally { suite.close() }
})

test('GitHub identity uses supplied credentials and verification changes only its throwaway copy', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'atomic-native-copy-'))
  const suite = new PersonalNativeSuite({ workspace, directory: workspace, githubOptions: {
    resolveToken: () => 'synthetic-token',
    apiFactory: token => { assert.equal(token, 'synthetic-token'); return { whoami: async () => ({ login: 'synthetic-user', name: null, scopes: [] }) } },
  } })
  try {
    const identity = await suite.run('github.whoami', {})
    assert.match(JSON.stringify(identity), /synthetic-user/)
    await writeFile(join(workspace, 'original.txt'), 'preserve')
    const args = { kind: 'command', cmd: process.execPath, args: ['-e', "require('node:fs').writeFileSync('original.txt','changed'); console.log('COPY_OK')"], checks: ['exit 0', 'stdout contains "COPY_OK"'] }
    const pending = await suite.run('verify.run', args)
    assert.equal(pending.status, 'approval_required')
    assert.equal(await readFile(join(workspace, 'original.txt'), 'utf8'), 'preserve')
    const result = await suite.run('verify.run', args, pending.pendingId)
    assert.equal(result.status, 'ok', JSON.stringify(result))
    assert.equal(await readFile(join(workspace, 'original.txt'), 'utf8'), 'preserve')
  } finally { suite.close() }
})

test('enabled desktop controls expose schemas and report missing OS permission without input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'atomic-screen-boundary-'))
  let probes = 0
  const suite = new PersonalNativeSuite({ workspace, directory: workspace, screenEnabled: true,
    screenDeps: { platform: 'darwin', run: async () => {
      probes++
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({
        screen: { width: 1440, height: 900, scale: 2 },
        accessibility: false, screenRecording: false,
        frontmost: { name: 'Synthetic app', bundleId: 'com.example.synthetic' },
      }) }
    } } })
  try {
    for (const action of ['capture', 'click', 'type', 'key']) {
      assert.ok(suite.describe(`os.screen.${action}`).inputSchema)
    }
    const capture = await suite.run('os.screen.capture', {})
    assert.equal(capture.status, 'error')
    const type = await suite.run('os.screen.type', { text: 'synthetic' })
    assert.equal(type.status, 'error')
    assert.equal(probes, 2)
    assert.match(JSON.stringify(type), /permission/i)
  } finally { suite.close() }
})
