import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersonalNotes } from './notes.mjs'

test('source-backed FTS notes survive restart without changing legacy memories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-notes-port-'))
  const legacy = '{"version":1,"memories":[{"text":"keep me"}],"tasks":[]}'
  await writeFile(join(directory, 'state.json'), legacy)
  const first = new PersonalNotes(directory, directory)
  const saved = first.call({ action: 'save', text: 'Synthetic orchard canary', source: 'qa/message-1', tags: ['qa'] })
  first.close()
  const second = new PersonalNotes(directory, directory)
  assert.equal(second.call({ action: 'search', query: 'orchard' }).entries[0].id, saved.id)
  assert.equal(second.call({ action: 'get', id: saved.id }).sessionId, 'qa/message-1')
  assert.throws(() => second.call({ action: 'save', text: 'No source' }), /source/)
  assert.equal(second.call({ action: 'forget', id: saved.id }).removed, true)
  second.close()
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), legacy)
})

test('profile history, note links and procedures retain evidence and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-knowledge-port-'))
  let notes = new PersonalNotes(directory, directory)
  notes.knowledge({ area: 'profile', action: 'save', key: 'favorite_color', text: 'blue', source: 'qa/user-1' })
  notes.knowledge({ area: 'profile', action: 'save', key: 'favorite_color', text: 'green', source: 'qa/user-2' })
  assert.equal(notes.knowledge({ area: 'profile', action: 'history', key: 'favorite_color' }).facts.length, 2)
  const a = notes.call({ action: 'save', text: 'First synthetic source', source: 'qa/source-a' })
  const b = notes.call({ action: 'save', text: 'Second synthetic source', source: 'qa/source-b' })
  notes.knowledge({ area: 'links', action: 'save', id: a.id, targetId: b.id, kind: 'RELATES_TO' })
  assert.ok(notes.knowledge({ area: 'links', action: 'get', id: a.id }).includes(b.id))
  const lesson = notes.knowledge({ area: 'lessons', action: 'save', id: a.id, activation: 'Synthetic test', text: 'Preserve the evidence before changing state.' })
  const procedure = notes.knowledge({ area: 'procedures', action: 'save', id: b.id, targetId: lesson.id, activation: 'Synthetic steps', steps: ['Read the evidence.', 'Check the result.'] })
  notes.close()
  notes = new PersonalNotes(directory, directory)
  assert.equal(notes.knowledge({ area: 'profile', action: 'get', key: 'favorite_color' }).value, 'green')
  const recalled = notes.call({ action: 'recall', query: 'color' }).entries
  assert.ok(recalled.some(row => row.content === 'favorite_color: green'))
  assert.ok(!recalled.some(row => row.content === 'favorite_color: blue'))
  assert.equal(notes.knowledge({ area: 'lessons', action: 'get', id: lesson.id }).parentIds[0], a.id)
  assert.equal(notes.knowledge({ area: 'procedures', action: 'get', id: procedure.id }).steps.length, 2)
  notes.knowledge({ area: 'procedures', action: 'forget', id: procedure.id })
  assert.equal(notes.knowledge({ area: 'procedures', action: 'get', id: procedure.id }).status, 'deprecated')
  notes.close()
})
