import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { runBroker, brokerPath } from './worker-broker.mjs'

test('two transports share one owner; closing one does not close the worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-broker-test-'))
  let owners = 0, closed = 0
  const broker = runBroker(directory, {
    idleMs: 30,
    create: async () => { owners++; return { controllers: new Map(), tick: async () => {}, shutdown: async () => { closed++ } } },
    serve: ({ input, output }) => new Promise(resolve => {
      input.on('data', data => output.write(data))
      input.once('close', resolve)
    }),
  })
  const open = async () => {
    for (let n = 0; n < 100; n++) {
      try { return await new Promise((resolve, reject) => { const s = createConnection(brokerPath(directory)); s.once('connect', () => resolve(s)); s.once('error', reject) }) }
      catch { await new Promise(resolve => setTimeout(resolve, 5)) }
    }
    throw new Error('broker not ready')
  }
  const a = await open(), b = await open()
  await runBroker(directory, { create: async () => { throw new Error('Duplicate owner') } })
  const aClosed = new Promise(resolve => a.once('close', resolve)); a.end(); await aClosed
  assert.equal(closed, 0)
  const echoed = new Promise(resolve => b.once('data', data => resolve(data.toString())))
  b.write('still alive')
  assert.equal(await echoed, 'still alive')
  b.end()
  await broker
  assert.equal(owners, 1)
  assert.equal(closed, 1)
})

test('disconnect during initialization does not leave shutdown waiting on a dead transport', { timeout: 3000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-broker-early-close-'))
  let closed = 0
  const broker = runBroker(directory, {
    idleMs: 10,
    create: async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return { controllers: new Map(), tick: async () => {}, shutdown: async () => { closed++ } }
    },
    serve: () => { throw new Error('A disconnected transport must not be served') },
  })
  broker.catch(() => {})
  let client
  for (let n = 0; n < 100 && !client; n++) {
    try { client = await new Promise((resolve, reject) => { const s = createConnection(brokerPath(directory)); s.once('connect', () => resolve(s)); s.once('error', reject) }) }
    catch { await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  assert.ok(client)
  client.end()
  await broker
  assert.equal(closed, 1)
})

test('reconnect cannot elect another owner while the previous store is draining', { timeout: 3000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-broker-draining-'))
  let entered, release
  const draining = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const broker = runBroker(directory, {
    idleMs: 10,
    create: async () => ({ controllers: new Map(), tick: async () => {}, shutdown: async () => { entered(); await gate } }),
    serve: ({ input }) => new Promise(resolve => input.once('close', resolve)),
  })
  broker.catch(() => {})
  let client
  for (let n = 0; n < 100 && !client; n++) {
    try { client = await new Promise((resolve, reject) => { const s = createConnection(brokerPath(directory)); s.once('connect', () => resolve(s)); s.once('error', reject) }) }
    catch { await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  assert.ok(client)
  client.end()
  await draining
  try { await runBroker(directory, { create: async () => { throw new Error('A second store owner was elected during shutdown') } }) }
  finally { release() }
  await broker
})
