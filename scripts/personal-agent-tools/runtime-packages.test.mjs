import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { copyRuntimePackages } from './runtime-packages.mjs'

test('packaged dependencies resolve without the source checkout or Agent runtime', async () => {
  const target = await mkdtemp(join(tmpdir(), 'atomic-runtime-packages-'))
  await copyRuntimePackages(['cron-parser', 'better-sqlite3'], join(target, 'node_modules'))
  const require = createRequire(join(target, 'worker.mjs'))
  const { CronExpressionParser } = require('cron-parser')
  assert.equal(CronExpressionParser.parse('0 10 * * *', { currentDate: '2026-11-02T00:00:00Z', tz: 'Asia/Seoul' }).next().toISOString(), '2026-11-02T01:00:00.000Z')
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  assert.equal(db.prepare('SELECT 17 AS value').get().value, 17)
  db.close()
})

test('packaging preserves dependency-local import-only and type-only packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-package-exports-'))
  const dependency = join(root, 'node_modules', 'synthetic-import-only')
  const types = join(dependency, 'node_modules', 'synthetic-types')
  await mkdir(types, { recursive: true })
  await writeFile(join(root, 'anchor.mjs'), '')
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'synthetic-import-only', version: '1.0.0', type: 'module', exports: { import: './index.mjs' }, dependencies: { 'synthetic-types': '1.0.0' } }))
  await writeFile(join(dependency, 'index.mjs'), 'export const canary = 71')
  await writeFile(join(types, 'package.json'), JSON.stringify({ name: 'synthetic-types', version: '1.0.0', types: './index.d.ts' }))
  await writeFile(join(types, 'index.d.ts'), 'export type Canary = 71')
  const target = join(root, 'packaged', 'node_modules')
  await copyRuntimePackages(['synthetic-import-only'], target, new URL(`file://${join(root, 'anchor.mjs')}`).href)
  const copied = join(target, 'synthetic-import-only')
  assert.equal((await import(new URL(`file://${join(copied, 'index.mjs')}`))).canary, 71)
  assert.equal(JSON.parse(await readFile(join(copied, 'node_modules/synthetic-types/package.json'), 'utf8')).version, '1.0.0')
})
