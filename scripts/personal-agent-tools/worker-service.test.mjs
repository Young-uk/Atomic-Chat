import test from 'node:test'
import assert from 'node:assert/strict'
import { workerPlist, WorkerService } from './worker-service.mjs'
const options = { node: '/test/node', entry: '/test/worker.mjs', directory: '/test/data', log: '/test/log' }
test('worker registration is disabled by default and escapes paths', () => {
  const text = workerPlist({ ...options, directory: '/test/a&b<c' })
  assert.match(text, /RunAtLoad<\/key><false\//)
  assert.match(text, /a&amp;b&lt;c/)
  assert.doesNotMatch(text, /KeepAlive<\/key><true/)
  assert.throws(() => workerPlist({ ...options, node: 'node' }))
})
test('missing job differs from launchctl failure', async () => {
  const service = new WorkerService({ home: '/nonexistent-personal-test', platform: 'darwin', uid: 1, run: async () => { throw Object.assign(new Error('Could not find service'), { stderr: 'Could not find service' }) } })
  assert.deepEqual(await service.status(), { supported: true, registered: false, enabledAtLogin: false, running: false })
  service.run = async () => { throw new Error('permission denied') }
  await assert.rejects(service.status(), /permission denied/)
})
test('registration alone never invokes launchctl and preserves endpoint/workspace', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const home = await mkdtemp(join(tmpdir(), 'atomic-worker-registration-'))
  let executions = 0
  const service = new WorkerService({ home, platform: 'darwin', uid: 1, run: async () => { executions++; return { stdout: '' } } })
  assert.deepEqual(await service.register({ ...options, environment: { ATOMIC_PERSONAL_ENDPOINT: 'http://127.0.0.1:8010/v1', ATOMIC_PERSONAL_WORKSPACE: '/test/chat workspace', SECRET: 'must-not-copy' } }), { registered: true, started: false, enabledAtLogin: false })
  assert.equal(executions, 0)
  const content = await readFile(service.path, 'utf8')
  assert.match(content, /http:\/\/127.0.0.1:8010\/v1/)
  assert.match(content, /\/test\/chat workspace/)
  assert.doesNotMatch(content, /must-not-copy|SECRET/)
})
