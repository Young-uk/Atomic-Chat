import test from 'node:test'
import assert from 'node:assert/strict'
import { auditAgentCatalog } from './agent-inventory.mjs'

const descriptor = name => ({ name, argsJsonSchema: { type: 'object', properties: {} } })

test('configuration-gated descriptors are not reported as connected features', () => {
  const result = auditAgentCatalog([descriptor('memory.notes.recall'), descriptor('tasks.cron')], ['memory.notes.recall'])
  assert.equal(result.complete, false)
  assert.deepEqual(result.tools.map(({ name, status }) => ({ name, status })), [
    { name: 'memory.notes.recall', status: 'available' }, { name: 'tasks.cron', status: 'unavailable' },
  ])
})

test('new upstream families and dynamic orphan tools cannot disappear from the migration audit', () => {
  const result = auditAgentCatalog([descriptor('new_family.action')], ['new_family.action', 'mcp__remote_lookup'])
  assert.equal(result.complete, false)
  assert.equal(result.tools[0].family, 'unclassified')
  assert.equal(result.tools[1].status, 'missing-descriptor')
})

test('duplicate upstream names are reported without reordering the offered catalog', () => {
  const descriptors = [descriptor('os.git.push'), descriptor('browser.click'), descriptor('os.git.push')]
  const original = structuredClone(descriptors)
  const result = auditAgentCatalog(descriptors, ['os.git.push', 'browser.click'])
  assert.deepEqual(result.duplicateNames, ['os.git.push'])
  assert.deepEqual(result.tools.map(tool => tool.name), ['os.git.push', 'browser.click'])
  assert.deepEqual(descriptors, original)
  assert.equal(result.complete, true)
  assert.notEqual(result.fingerprint, auditAgentCatalog([descriptors[1], descriptors[0], descriptors[2]], ['os.git.push', 'browser.click']).fingerprint)
})

test('registered tools without an authoritative object schema are not offered as ready', () => {
  const result = auditAgentCatalog([{ name: 'os.fs.read', argsJsonSchema: null }], ['os.fs.read'])
  assert.equal(result.tools[0].status, 'missing-schema')
  assert.equal(result.complete, false)
})
