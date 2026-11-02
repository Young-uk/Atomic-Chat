import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real stdio MCP handshake, tool invocation and persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-personal-mcp-test-'))
  await mkdir(join(directory, 'chat', 'path-test'), { recursive: true })
  await writeFile(join(directory, 'chat', 'path-test', 'winter_test.py'), 'print("OK")')
  await writeFile(join(directory, 'winter_test.py'), 'def broken(')
  async function session() {
    const child = spawn(process.execPath, ['scripts/personal-agent-tools/server.mjs'], { env: { ...process.env, ATOMIC_PERSONAL_TOOLS_DIR: directory, ATOMIC_PERSONAL_WORKSPACE: directory }, stdio: ['pipe','pipe','pipe'] })
    const waiting = new Map()
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => { const value = JSON.parse(line); waiting.get(value.id)?.(value) })
    let id = 0
    return { request(method, params) { const requestId = ++id; return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Protocol response timed out')), 5000)
      waiting.set(requestId, value => { clearTimeout(timeout); waiting.delete(requestId); resolve(value) })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
    }) }, async close() { const closed = new Promise(resolve => child.once('exit', resolve)); child.stdin.end(); await closed; lines.close() } }
  }
  const a = await session()
  try {
    assert.equal((await a.request('initialize', {})).result.serverInfo.name, 'atomic-personal-tools')
    const names = (await a.request('tools/list', {})).result.tools.map(tool => tool.name)
    assert.ok(names.includes('personal_task_delivery'))
    const delivery = await a.request('tools/call', { name: 'personal_task_delivery', arguments: { action: 'pending' } })
    assert.deepEqual(JSON.parse(delivery.result.content[0].text), [])
    for (const name of ['personal_memory', 'personal_tasks', 'personal_browser', 'personal_windows', 'personal_watch', 'personal_verify']) assert.ok(names.includes(name))
    const checked = await a.request('tools/call', { name: 'personal_verify', arguments: { action: 'syntax', files: ['winter_test.py'], originThreadId: 'path-test' } })
    assert.equal(checked.result.isError, undefined)
    assert.equal(JSON.parse(checked.result.content[0].text).passed, 1)
    const saved = await a.request('tools/call', { name: 'personal_memory', arguments: { action: 'save', text: 'Protocol canary', source: 'synthetic/test' } })
    assert.equal(saved.result.isError, undefined)
    const invalid = await a.request('tools/call', { name: 'personal_memory', arguments: { action: 'save', text: 'missing source' } })
    assert.equal(invalid.result.isError, true)
  } finally { await a.close() }
  const b = await session()
  try {
    const result = await b.request('tools/call', { name: 'personal_memory', arguments: { action: 'search', query: 'canary' } })
    assert.equal(JSON.parse(result.result.content[0].text)[0].source, 'synthetic/test')
  } finally { await b.close() }
})
