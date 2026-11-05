import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyCall } from './verify.mjs'

test('port checks every script, preserves originals and never executes source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-verify-port-'))
  const fixtures = { 'valid.mjs': 'throw new Error("must not execute")', 'bad.mjs': 'export const x = {', 'bad.py': 'def broken(', 'unknown.blob': 'unknown' }
  for (const [name, source] of Object.entries(fixtures)) await writeFile(join(root, name), source)
  const report = await verifyCall({ action: 'syntax', files: Object.keys(fixtures) }, root)
  assert.equal(report.passed, 1)
  assert.equal(report.failed, 2)
  assert.equal(report.unchecked, 1)
  assert.equal(report.results[3].ok, null)
  for (const [name, source] of Object.entries(fixtures)) assert.equal(await readFile(join(root, name), 'utf8'), source)
  assert.deepEqual((await readdir(root)).sort(), Object.keys(fixtures).sort())
})

test('outside paths and symlinks fail before invoking any checker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-verify-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'atomic-verify-outside-'))
  const file = join(outside, 'secret.mjs')
  await writeFile(file, 'export const x = 1')
  await symlink(file, join(root, 'linked.mjs'))
  for (const path of [file, 'linked.mjs']) await assert.rejects(verifyCall({ action: 'syntax', files: [path] }, root), /outside/)
  await assert.rejects(verifyCall({ action: 'syntax', files: [] }, root), /non-empty/)
})


test('relative verification follows the script chat directory without shadowing legacy callers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-verify-chat-'))
  await mkdir(join(root, 'chat', 'thread-a'), { recursive: true })
  await writeFile(join(root, 'chat', 'thread-a', 'winter_test.py'), 'print("OK")')
  await writeFile(join(root, 'winter_test.py'), 'def broken(')
  const args = { action: 'syntax', files: ['winter_test.py'] }
  assert.equal((await verifyCall(args, root, 'thread-a')).passed, 1)
  assert.equal((await verifyCall(args, root)).failed, 1)
  await assert.rejects(verifyCall(args, root, '../outside'), /Invalid verification thread/)
  const outside = await mkdtemp(join(tmpdir(), 'atomic-verify-chat-outside-'))
  await writeFile(join(outside, 'outside.py'), 'print("NO")')
  await symlink(join(outside, 'outside.py'), join(root, 'chat', 'thread-a', 'linked.py'))
  await assert.rejects(verifyCall({ action: 'syntax', files: ['linked.py'] }, root, 'thread-a'), /outside/)
})

test('JSON verification is strict while explicit JSONC keeps comments and trailing commas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-verify-json-'))
  const fixtures = {
    'bad.json': '{"a": 1,}',
    'comments.json': '{/* comment */"a":1}',
    'valid.json': '{"url":"https://example.com/a//b", "text":",}"}',
    'config.jsonc': '{/* comment */"a":1,}',
    'broken.jsonc': '{"a": }',
  }
  for (const [name, source] of Object.entries(fixtures)) await writeFile(join(root, name), source)
  const report = await verifyCall({ action: 'syntax', files: Object.keys(fixtures) }, root)
  assert.deepEqual(report.results.map(result => result.ok), [false, false, true, true, false])
  assert.deepEqual(report.results.map(result => result.checker), ['JSON.parse', 'JSON.parse', 'JSON.parse', 'JSONC.parse', 'JSONC.parse'])
  for (const [name, source] of Object.entries(fixtures)) assert.equal(await readFile(join(root, name), 'utf8'), source)
})
