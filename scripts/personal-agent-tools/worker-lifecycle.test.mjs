import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('a holding service preserves one scheduled run after the app disconnects', { timeout: 20000 }, async () => {
  let calls = 0
  const endpoint = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/models') return res.end(JSON.stringify({ atomic_summary_slot: true, data: [] }))
    calls++
    req.resume()
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic reminder' } }] }))
  })
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve))
  const directory = await mkdtemp(join(tmpdir(), 'atomic-worker-lifecycle-'))
  const env = { ...process.env, ATOMIC_PERSONAL_TOOLS_DIR: directory, ATOMIC_PERSONAL_WORKSPACE: directory, ATOMIC_PERSONAL_ENDPOINT: `http://127.0.0.1:${endpoint.address().port}/v1` }
  const children = []
  const start = args => { const child = spawn(process.execPath, ['scripts/personal-agent-tools/server.mjs', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child }
  const session = () => {
    const child = start([]), waiting = new Map()
    let sequence = 0
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => { const value = JSON.parse(line); waiting.get(value.id)?.(value) })
    return {
      request(method, params) {
        const id = ++sequence
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker protocol timeout')), 8000)
          waiting.set(id, value => { clearTimeout(timer); waiting.delete(id); resolve(value) })
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        })
      },
      async close() { const ended = new Promise(resolve => child.once('exit', resolve)); child.stdin.end(); await ended; lines.close() },
    }
  }
  try {
    const app = session()
    await app.request('initialize', {})
    const hold = start(['--worker'])
    // Wait until the holder is connected by exercising a second app transport.
    const probe = session(); await probe.request('ping', {}); await probe.close()
    await new Promise(resolve => setTimeout(resolve, 300))
    const response = await app.request('tools/call', { name: 'personal_tasks', arguments: { action: 'create', prompt: 'Synthetic reminder', at: new Date(Date.now() + 1600).toISOString() } })
    assert.equal(response.result.isError, undefined)
    await app.close()
    await new Promise(resolve => setTimeout(resolve, 3500))
    const reopened = session()
    const pending = await reopened.request('tools/call', { name: 'personal_task_delivery', arguments: { action: 'pending' } })
    assert.equal(JSON.parse(pending.result.content[0].text).length, 1)
    assert.equal(calls, 1)
    hold.kill('SIGTERM')
    await reopened.request('ping', {})
    await reopened.close()
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
    endpoint.closeAllConnections()
    await new Promise(resolve => endpoint.close(resolve))
  }
})
