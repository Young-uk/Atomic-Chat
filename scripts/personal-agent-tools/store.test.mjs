import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalStore } from './store.mjs'
import { PersonalTools } from './server.mjs'
import { publicUrl, publicAddress } from './browser.mjs'

const fresh = async now => new PersonalStore(await mkdtemp(join(tmpdir(), 'atomic-personal-tools-test-')), now)

test('scheduled voice and origin survive restart while delivery failures never rerun inference', async () => {
  let now = Date.parse('2026-11-02T00:00:00Z')
  const store = await fresh(() => now)
  const created = await store.task('create', { prompt: 'Synthetic reminder', at: '2026-11-02T00:01:00Z', originThreadId: 'synthetic-thread', assistantInstructions: 'Use formal English and call the user Captain.' })
  assert.equal(created.assistantInstructions, undefined)
  now += 60000
  let calls = 0
  const tools = new PersonalTools({ directory: store.directory, store, infer: async (_prompt, _signal, task) => {
    calls++
    assert.equal(task.assistantInstructions, 'Use formal English and call the user Captain.')
    return 'Captain, your reminder is ready.'
  } })
  await tools.tick()
  const reopened = new PersonalStore(store.directory, () => now)
  const [pending] = await reopened.delivery('pending')
  assert.equal(pending.threadId, 'synthetic-thread')
  await reopened.delivery('record', { taskId: created.id, runId: pending.id, messageId: 'synthetic-message', error: 'Synthetic notification permission failure' })
  assert.equal((await reopened.delivery('pending'))[0].delivery.error, 'Synthetic notification permission failure')
  await tools.tick()
  assert.equal(calls, 1)
  await reopened.delivery('record', { taskId: created.id, runId: pending.id, messageId: 'synthetic-message' })
  assert.deepEqual(await reopened.delivery('pending'), [])
  assert.equal((await reopened.task('get', { id: created.id })).runs[0].result, 'Captain, your reminder is ready.')
  await tools.shutdown()
})

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

test('cron previews and recurring completion preserve timezone across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-cron-port-'))
  let now = Date.parse('2026-11-02T00:00:00Z')
  const store = new PersonalStore(directory, () => now)
  const args = { cron: '0 10 * * *', timezone: 'Asia/Seoul', prompt: 'Synthetic reminder' }
  const preview = await store.task('preview', args)
  assert.equal(preview.times[0], '2026-11-02T01:00:00.000Z')
  const task = await store.task('create', args)
  assert.equal(task.dueAt, Date.parse(preview.times[0]))
  now = task.dueAt
  assert.equal((await store.claimDue()).id, task.id)
  await store.finish(task.id, 'Done')
  const restored = await new PersonalStore(directory, () => now).task('get', { id: task.id })
  assert.equal(restored.dueAt, Date.parse('2026-11-03T01:00:00Z'))
  assert.equal(restored.status, 'scheduled')
  assert.equal(restored.schedule.tz, 'Asia/Seoul')
  await assert.rejects(store.task('create', { ...args, at: '2026-11-04T00:00:00Z' }), /not both/)
  await assert.rejects(store.task('preview', { cron: '* * * * *', timezone: 'invalid/zone' }), /invalid/)
})


test('relative repeats start at receipt and expired explicit starts never create tasks', async () => {
  let now = Date.parse('2026-11-03T05:11:55Z')
  const store = await fresh(() => now)
  const repeated = await store.task('create', { prompt: 'Synthetic repeat', intervalSeconds: 90 })
  assert.equal(repeated.dueAt, now + 90000)
  assert.equal(repeated.intervalSeconds, 90)
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(store.task('create', { prompt: 'Expired', at: '2026-11-03T14:11:00+09:00', intervalSeconds: 90 }), error => {
      assert.equal(error.scheduleValidation.code, 'start_time_passed')
      assert.equal(error.scheduleValidation.retryable, false)
      assert.equal(error.scheduleValidation.taskCreated, false)
      assert.equal(error.scheduleValidation.overdueSeconds, 55)
      assert.equal(error.scheduleValidation.currentTime, '2026-11-03T05:11:55.000Z')
      return true
    })
  }
  assert.equal((await store.task('list')).length, 1)
  await assert.rejects(store.task('create', { prompt: 'Missing' }), error => error.scheduleValidation.code === 'missing_start_time')
  await assert.rejects(store.task('create', { prompt: 'No zone', at: '2026-11-03T14:15:00' }), error => error.scheduleValidation.code === 'invalid_start_time')
  await assert.rejects(store.task('create', { prompt: 'Too short', intervalSeconds: 30 }), /at least 60/)
  now += 10000
  const future = await store.task('create', { prompt: 'Explicit', at: '2026-11-03T14:15:00+09:00' })
  assert.equal(future.dueAt, Date.parse('2026-11-03T05:15:00Z'))
})

test('failed repeating occurrences skip delivery and continue on the original interval grid', async () => {
  let now = Date.parse('2026-11-03T06:38:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Synthetic repeat', intervalSeconds: 120 })
  now = task.dueAt
  await store.claimDue()
  now += 185000
  await store.finish(task.id, null, 'This operation was aborted')
  const restored = await store.task('get', { id: task.id })
  assert.equal(restored.status, 'scheduled')
  assert.equal(restored.dueAt, task.dueAt + 240000)
  assert.equal(restored.runs.at(-1).error, 'This operation was aborted')
  assert.equal(restored.runs.at(-1).delivery.status, 'skipped')
  assert.deepEqual(await store.delivery('pending'), [])
})

test('failed cron occurrence advances without replaying missed fires', async () => {
  let now = Date.parse('2026-11-03T06:37:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Synthetic cron', cron: '*/2 * * * *', timezone: 'Asia/Seoul' })
  now = task.dueAt
  await store.claimDue()
  now = Date.parse('2026-11-03T06:45:00Z')
  await store.finish(task.id, null, 'This operation was aborted')
  const restored = await store.task('get', { id: task.id })
  assert.equal(restored.status, 'scheduled')
  assert.equal(restored.dueAt, Date.parse('2026-11-03T06:46:00Z'))
  assert.equal(restored.runs.at(-1).delivery.status, 'skipped')
})

test('scheduled inference explicitly receives the schedule local time zone', async () => {
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ atomic_summary_slot: true }))
    sent = JSON.parse(options.body)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic reminder' } }] }))
  }
  const store = await fresh()
  const tools = new PersonalTools({ directory: store.directory, store })
  try {
    await tools.infer('Synthetic reminder', new AbortController().signal, { schedule: { tz: 'Asia/Seoul' } })
    assert.match(sent.messages[0].content, /Current execution time: .*\(Asia\/Seoul\)/)
    assert.match(sent.messages[0].content, /Use the local execution time/)
    await tools.infer('Synthetic one-shot reminder', new AbortController().signal, { timezone: 'Asia/Seoul' })
    assert.match(sent.messages[0].content, /Current execution time: .*\(Asia\/Seoul\)/)
  } finally { globalThis.fetch = originalFetch; await tools.shutdown() }
})

test('one-shot reminders retain an explicit time zone and occurrence timestamps', async () => {
  let now = Date.parse('2026-11-05T00:00:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Synthetic reminder', at: '2026-11-05T09:01:00+09:00', timezone: 'Asia/Seoul' })
  now += 60000
  const claimed = await store.claimDue()
  assert.equal(claimed.timezone, 'Asia/Seoul')
  assert.equal(claimed.startedAt, now)
  now += 5000
  await store.finish(task.id, 'Synthetic result')
  const run = (await store.task('get', { id: task.id })).runs[0]
  assert.equal(run.startedAt, Date.parse('2026-11-05T00:01:00Z'))
  assert.equal(run.dueAt, run.startedAt)
  assert.equal(run.finishedAt - run.startedAt, 5000)
  await assert.rejects(store.task('create', { prompt: 'Invalid zone', at: '2026-11-05T09:10:00+09:00', timezone: 'Invalid/Zone' }))
})

test('scheduled timeout records its cause rather than an opaque aborted error', async () => {
  let now = Date.parse('2026-11-05T00:00:00Z')
  const store = await fresh(() => now)
  const task = await store.task('create', { prompt: 'Synthetic reminder', at: '2026-11-05T00:01:00Z' })
  now += 60000
  const tools = new PersonalTools({ directory: store.directory, store, taskTimeoutMs: 5,
    infer: async (_prompt, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('This operation was aborted')), { once: true })) })
  try {
    await tools.tick()
    const result = await store.task('get', { id: task.id })
    assert.match(result.runs[0].error, /Scheduled generation timed out/)
    assert.equal(result.runs[0].delivery.status, 'skipped')
    assert.equal(result.status, 'failed')
  } finally { await tools.shutdown() }
})
