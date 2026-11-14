import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('history discovery and search/context work through the real MCP worker protocol', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-history-protocol-'))
  const directory = join(root, 'data'), workspace = join(root, 'agent-workspace')
  await mkdir(directory); await mkdir(workspace)
  for (const id of ['origin', 'previous']) {
    const folder = join(root, 'threads', id); await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'thread.json'), JSON.stringify({ id, title: id, assistants: [{ id: 'winter' }] }))
    await writeFile(join(folder, 'messages.jsonl'), JSON.stringify({ id: id === 'previous' ? 'outfit' : 'current', thread_id: id, role: 'user', created_at: Date.parse('2026-11-13T01:00:00Z'), content: [{ type: 'text', text: { value: id === 'previous' ? 'Cold weather, thin jacket.' : 'Find what I said.' } }] }) + '\n')
  }
  const child = spawn(process.execPath, ['scripts/personal-agent-tools/server.mjs'], { env: { ...process.env, ATOMIC_PERSONAL_TOOLS_DIR: directory, ATOMIC_PERSONAL_WORKSPACE: workspace }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const waiting = new Map(); let id = 0
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => { const value = JSON.parse(line); waiting.get(value.id)?.(value) })
  const request = (method, params) => new Promise((resolve, reject) => {
    const key = ++id
    const onExit = code => { clearTimeout(timer); waiting.delete(key); reject(new Error(`History worker exited (${code}): ${stderr}`)) }
    const timer = setTimeout(() => { child.off('exit', onExit); waiting.delete(key); reject(new Error(`History protocol timeout: ${stderr}`)) }, 10000)
    child.once('exit', onExit)
    waiting.set(key, value => { child.off('exit', onExit); clearTimeout(timer); waiting.delete(key); resolve(value) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n')
  })
  try {
    await request('initialize', {})
    const tools = (await request('tools/list', {})).result.tools
    const schema = tools.find(tool => tool.name === 'personal_chat_history').inputSchema
    assert.equal(schema.additionalProperties, false)
    assert.equal(schema.properties.originThreadId, undefined)
    assert.equal(schema.properties.originTimeZone, undefined)
    const call = async args => (await request('tools/call', { name: 'personal_chat_history', arguments: args })).result
    assert.equal((await call({ action: 'search', query: 'weather' })).isError, true)
    const binding = { originThreadId: 'origin', originTimeZone: 'Asia/Seoul' }
    const found = await call({ action: 'search', query: 'weather', withContext: true, ...binding })
    assert.notEqual(found.isError, true)
    const result = JSON.parse(found.content[0].text)
    assert.equal(result.context.messages[0].text, 'Cold weather, thin jacket.')
    const hit = result.hits[0]
    assert.equal(hit.threadId, 'previous')
    const read = await call({ action: 'context', threadId: hit.threadId, messageId: hit.messageId, ...binding })
    assert.equal(JSON.parse(read.content[0].text).messages[0].text, 'Cold weather, thin jacket.')
    assert.equal((await call({ action: 'search', query: 'weather', unexpected: true, ...binding })).isError, true)
    const legacy = join(root, 'threads', 'legacy'); await mkdir(legacy)
    await writeFile(join(legacy, 'thread.json'), JSON.stringify({ id: 'legacy', title: 'previous assistant version', assistants: [{ id: 'winter-old' }] }))
    await writeFile(join(legacy, 'messages.jsonl'), JSON.stringify({ id: 'old', thread_id: 'legacy', role: 'user', created_at: Date.parse('2026-11-08T01:00:00Z'), content: [{ type: 'text', text: { value: 'Legacy sentinel' } }] }) + '\n')
    const settings = JSON.parse((await request('tools/call', { name: 'personal_feature_settings', arguments: { action: 'get' } })).result.content[0].text)
    const configured = await request('tools/call', { name: 'personal_feature_settings', arguments: { action: 'set', settings: { ...settings, chatHistory: { assistantGroups: [['winter', 'winter-old']] } } } })
    assert.notEqual(configured.result.isError, true)
    const linked = JSON.parse((await call({ action: 'search', query: 'sentinel', day: '2026-11-08', withContext: true, ...binding })).content[0].text)
    assert.equal(linked.scope, 'linked-assistants-and-project')
    assert.equal(linked.hits[0].threadId, 'legacy')
    assert.equal(linked.context.messages[0].text, 'Legacy sentinel')
    assert.equal(linked.scopeInfo.retention, 'no-age-limit')

  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise(resolve => child.once('exit', resolve))
      child.stdin.end(); await ended
    }
    lines.close()
    await rm(root, { recursive: true, force: true })
  }
})
