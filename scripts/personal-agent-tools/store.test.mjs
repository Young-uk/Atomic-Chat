import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalStore } from './store.mjs'
import { PersonalTools } from './server.mjs'
import { publicUrl, publicAddress } from './browser.mjs'

const fresh = async now => new PersonalStore(await mkdtemp(join(tmpdir(), 'atomic-personal-tools-test-')), now)

test('concurrent writes survive restart and preserve provenance', async () => {
  const store = await fresh()
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.memory('save', { text: `Memory ${i}`, source: `chat/message/${i}` })))
  const reopened = new PersonalStore(store.directory)
  const rows = await reopened.memory('search', { query: 'Memory' })
  assert.equal(rows.length, 20)
  assert.equal(new Set(rows.map(row => row.id)).size, 20)
  assert.ok(rows.every(row => row.source.startsWith('chat/message/')))
  await assert.rejects(store.memory('save', { text: 'Missing source' }))
  assert.equal((await store.memory('list')).length, 20)
})

test('update and forget affect only the selected memory', async () => {
  const store = await fresh()
  const a = await store.memory('save', { text: 'Old', source: 'chat/1' })
  const b = await store.memory('save', { text: 'Keep', source: 'chat/2' })
  await store.memory('update', { id: a.id, text: 'New', source: 'chat/3' })
  assert.equal((await store.memory('search', { query: 'New' }))[0].source, 'chat/3')
  await store.memory('forget', { id: a.id })
  assert.equal((await store.memory('list'))[0].id, b.id)
})

test('missed and interrupted schedules do not replay on restart', async () => {
  let now = Date.parse('2026-11-01T00:00:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Reminder', at: '2026-11-01T00:01:00Z' })
  now += 120000
  await store.reconcileStartup()
  assert.equal(await store.claimDue(), null)
  assert.equal((await store.task('list'))[0].status, 'missed')
  await store.task('cancel', { id: task.id })
  await store.finish(task.id, 'Late result')
  assert.equal((await store.task('list'))[0].status, 'cancelled')
})

test('scheduler does one inference and persists its result without tools', async () => {
  let now = Date.parse('2026-11-01T00:00:00Z')
  const store = await fresh(() => now)
  await store.task('create', { prompt: 'Say READY', at: '2026-11-01T00:01:00+00:00' })
  let calls = 0
  const tools = new PersonalTools({ directory: store.directory, store, notify: () => {}, infer: async prompt => { calls++; assert.equal(prompt, 'Say READY'); return 'READY' } })
  now += 60000
  await Promise.all([tools.tick(), tools.tick()])
  assert.equal(calls, 1)
  const task = (await store.task('list'))[0]
  assert.equal(task.status, 'completed')
  assert.equal(task.runs[0].result, 'READY')
  const disk = JSON.parse(await readFile(join(store.directory, 'state.json'), 'utf8'))
  assert.equal(disk.tasks[0].status, 'completed')
})

test('rejects private browser targets including DNS resolutions and IPv6', async () => {
  for (const address of ['127.0.0.1','10.1.2.3','192.168.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(publicAddress(address), false)
  await assert.rejects(publicUrl('https://example.com', async () => ['127.0.0.1']))
  await assert.rejects(publicUrl('file:///etc/passwd'))
  assert.equal(await publicUrl('https://example.com', async () => ['93.184.216.34']), 'https://example.com/')
})

test('rejects invalid tools and unsafe scheduled endpoints', async () => {
  const store = await fresh()
  assert.throws(() => new PersonalTools({ directory: store.directory, endpoint: 'https://example.com/v1' }))
  const tools = new PersonalTools({ directory: store.directory })
  await assert.rejects(tools.call('personal_memory', { action: 'save', text: 'X', source: 'Y', command: 'unsafe' }))
})

test('cancelling a running scheduled task aborts inference and never resurrects it', async () => {
  let now = Date.parse('2026-11-01T00:00:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Pending', at: '2026-11-01T00:01:00Z' })
  let started
  const ready = new Promise(resolve => { started = resolve })
  const tools = new PersonalTools({ directory: store.directory, store, notify: () => {}, infer: async (_, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    started()
  }) })
  now += 60000
  const running = tools.tick()
  await ready
  await tools.call('personal_tasks', { action: 'cancel', id: task.id })
  await running
  assert.equal((await store.task('list'))[0].status, 'cancelled')
})

test('read-only polling does not rewrite the persistent state file', async () => {
  const store = await fresh()
  await store.memory('save', { text: 'Keep', source: 'synthetic/source' })
  const { stat } = await import('node:fs/promises')
  const path = join(store.directory, 'state.json')
  const before = await stat(path)
  await store.memory('list')
  await store.task('list')
  await store.claimDue()
  const after = await stat(path)
  assert.equal(after.ino, before.ino)
  assert.equal(after.mtimeMs, before.mtimeMs)
})
