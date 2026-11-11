import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalTools } from './server.mjs'
import { logTail } from './documents.mjs'

test('missing native action recovers exact failed calls while preserving inspected approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-routing-'))
  const tools = new PersonalTools({ directory, browser: { shutdown: async () => {} } })
  try {
    const path = join(tools.watch.root, 'probe.txt')
    const pending = await tools.call('personal_native', { name: 'os.fs.write', input: JSON.stringify({ path, content: 'original v1' }) })
    assert.equal(pending.status, 'approval_required')
    await assert.rejects(readFile(path), { code: 'ENOENT' })
    await tools.call('personal_native', { action: 'confirm', pendingId: pending.pendingId })
    assert.equal(await readFile(path, 'utf8'), 'original v1')
    const shell = await tools.call('personal_native', { name: 'os.shell.run', input: JSON.stringify({ cmd: 'printf atomic-routing-ok' }) })
    assert.equal(shell.status, 'approval_required')
    const result = await tools.call('personal_native', { action: 'confirm', pendingId: shell.pendingId })
    assert.match(JSON.stringify(result), /atomic-routing-ok/)
    await assert.rejects(tools.call('personal_native', { name: 'custom.ambiguous', input: '{}', code: 'return 1' }), /action/)
    await assert.rejects(tools.call('personal_native', { action: 'bad', name: 'os.fs.write', input: '{}' }), /Invalid action/)
    const document = await tools.call('personal_document', { path: 'probe.txt', format: 'plain' })
    assert.match(document.text, /original v1/)
    await assert.rejects(tools.call('personal_document', { path: '/etc/hosts', format: 'plain' }), /outside/)
  } finally { await tools.shutdown(); await rm(directory, { recursive: true, force: true }) }
})

test('diagnostic log reads tail known real sources, bound output, and reject arbitrary files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atomic-log-tail-'))
  const directory = join(home, 'Library/Application Support/Atomic Chat/data/logs')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'app.log')
  try {
    await writeFile(path, `${'x'.repeat(300000)}\nolder\nAuthorization: Bearer secret-value\napi_key=secret\nlast\n`)
    const result = await logTail({ source: 'app', lines: 3 }, home)
    assert.equal(result.truncated, true)
    assert.equal(result.untrusted, true)
    assert.match(result.text, /last/)
    assert.doesNotMatch(result.text, /secret/)
    assert.doesNotMatch(result.text, /older/)
    await assert.rejects(logTail({ source: '../other' }, home), /Choose a log source/)
    await assert.rejects(logTail({ source: 'app', lines: 501 }, home), /between/)
    await assert.rejects(logTail({ source: 'app', path: '/etc/hosts' }, home), /not document paths/)
    await rm(path)
    await symlink('/etc/hosts', path)
    await assert.rejects(logTail({ source: 'app' }, home), /symlinks/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
