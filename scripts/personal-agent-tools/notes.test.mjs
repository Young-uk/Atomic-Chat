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
  assert.equal(second.call({ action: 'get', id: saved.id }).sourceReference, 'qa/message-1')
  assert.equal(second.call({ action: 'get', id: saved.id }).sessionId, null)
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

test('separates note provenance from sessions and reads legacy rows without migration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-notes-provenance-'))
  const notes = new PersonalNotes(directory, directory)
  const old = notes.database().store({ content: 'Legacy maple evidence', source: 'user', sessionId: 'old/message-1' })
  const saved = notes.call({ action: 'save', text: 'New maple evidence', sourceReference: 'new/message-2', sessionId: 'actual-chat' })
  assert.equal(saved.author, 'user')
  assert.equal(saved.sourceReference, 'new/message-2')
  assert.equal(saved.sessionId, 'actual-chat')
  notes.close()
  const restored = new PersonalNotes(directory, directory)
  const legacy = restored.call({ action: 'get', id: old.id })
  assert.equal(legacy.sourceReference, 'old/message-1')
  assert.equal(legacy.sessionId, null)
  assert.equal(restored.database().get(old.id).sessionId, 'old/message-1')
  for (const entry of restored.call({ action: 'search', query: 'maple' }).entries) {
    assert.ok(entry.sourceReference)
    assert.equal(entry.author, 'user')
  }
  assert.equal(restored.call({ action: 'list' }).find(row => row.id === saved.id).sessionId, 'actual-chat')
  assert.equal(restored.call({ action: 'forget', id: saved.id }).removed, true)
  assert.equal(restored.provenanceDatabase().prepare('SELECT * FROM atomic_note_provenance WHERE note_id = ?').get(saved.id), undefined)
  restored.close()
})

test('knowledge exposes profile search and explicit evidence identifiers with legacy compatibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-knowledge-contract-'))
  const n = new PersonalNotes(directory, directory)
  const saved = n.knowledge({ area: 'profile', action: 'save', key: 'qa_path', text: 'Relative file paths', sourceReference: 'qa/message', sessionId: 'qa-session' })
  assert.equal(n.knowledge({ area: 'profile', action: 'get', id: saved.fact.id }).key, 'qa_path')
  assert.equal(n.knowledge({ area: 'profile', action: 'history', id: saved.fact.id }).total, 1)
  assert.equal(n.knowledge({ area: 'profile', action: 'search', query: 'FILE' }).facts[0].key, 'qa_path')
  assert.equal(n.knowledge({ area: 'profile', action: 'search', query: 'missing' }).total, 0)
  const lesson = n.knowledge({ area: 'lessons', action: 'save', sourceNoteId: saved.evidenceNoteId, activation: 'checking paths', text: 'Use the chat directory' })
  const procedure = n.knowledge({ area: 'procedures', action: 'save', sourceNoteId: saved.evidenceNoteId, parentLessonId: lesson.id, activation: 'verify paths', steps: ['Create file', 'Read file'] })
  assert.deepEqual(procedure.parentMemoryIds, [saved.evidenceNoteId])
  assert.deepEqual(procedure.parentLessonIds, [lesson.id])
  assert.throws(() => n.knowledge({ area: 'procedures', action: 'save', sourceNoteId: saved.evidenceNoteId, activation: 'paths', steps: ['Create', 'Read'] }), /parentLessonId/)
  assert.throws(() => n.knowledge({ area: 'lessons', action: 'save', sourceNoteId: 999999, activation: 'paths', text: 'No evidence' }), /sourceNoteId/)
  n.close()
})

test('profile search matches all terms independently and fact links never alias note links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-profile-links-'))
  let n = new PersonalNotes(directory, directory)
  const a = n.knowledge({ area: 'profile', action: 'save', key: 'path', text: '상대경로 personal_document 모두', source: 'qa/a' }).fact
  const b = n.knowledge({ area: 'profile', action: 'save', key: 'other', text: 'personal_document only', source: 'qa/b' }).fact
  for (const query of ['경로 personal_document', 'PERSONAL_DOCUMENT 경로', ' path   경로 ']) {
    assert.deepEqual(n.knowledge({ area: 'profile', action: 'search', query }).facts.map(f => f.id), [a.id])
  }
  assert.equal(n.knowledge({ area: 'profile', action: 'search', query: '경로 absent' }).total, 0)
  const edge = { area: 'links', entityType: 'profile', action: 'save', id: a.id, targetId: b.id, kind: 'DUPLICATES' }
  n.knowledge(edge)
  n.knowledge(edge)
  assert.equal(n.knowledge({ area: 'links', action: 'list' }).length, 0)
  assert.equal(n.knowledge({ ...edge, action: 'list' }).length, 1)
  assert.deepEqual(n.knowledge({ ...edge, action: 'get' }), [b.id])
  assert.throws(() => n.knowledge({ ...edge, targetId: 99999 }), /existing profile fact/)
  assert.throws(() => n.knowledge({ ...edge, entityType: 'note', targetId: 99999 }), /existing note/)
  n.close()
  n = new PersonalNotes(directory, directory)
  assert.deepEqual(n.knowledge({ ...edge, action: 'get' }), [b.id])
  assert.equal(n.knowledge({ ...edge, action: 'forget' }).removed, true)
  assert.deepEqual(n.knowledge({ ...edge, action: 'get' }), [])
  n.knowledge(edge)
  n.knowledge({ area: 'profile', action: 'forget', key: 'other' })
  assert.equal(n.knowledge({ ...edge, action: 'list' }).length, 0)
  n.close()
})

test('lesson and procedure history reports retained lifecycle without inventing versions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-knowledge-lifecycle-'))
  let n = new PersonalNotes(directory, directory)
  const note = n.call({ action: 'save', text: 'History evidence', source: 'qa/history' })
  const lesson = n.knowledge({ area: 'lessons', action: 'save', sourceNoteId: note.id, activation: 'history test', text: 'Keep evidence.' })
  const procedure = n.knowledge({ area: 'procedures', action: 'save', sourceNoteId: note.id, parentLessonId: lesson.id, activation: 'history test', steps: ['Read evidence', 'Report result'] })
  for (const [area, entry] of [['lessons', lesson], ['procedures', procedure]]) {
    const query = { area, action: 'history', id: entry.id }
    assert.equal(n.knowledge(query).found, true)
    assert.deepEqual(n.knowledge(query).events, [{ action: 'created', at: entry.createdAt }])
    n.knowledge({ ...query, action: 'forget' })
    const history = n.knowledge(query)
    assert.equal(history.scope, 'lifecycle')
    assert.equal(history.found, true)
    assert.equal(history.reason, undefined)
    assert.equal(history.entry.status, 'deprecated')
    assert.equal(history.events[1].at, history.entry.deprecatedAt)
    assert.deepEqual(n.knowledge({ ...query, id: 999999 }), { scope: 'lifecycle', found: false, reason: 'not_found', entry: null, events: [] })
    for (const id of [undefined, 0, -1, 1.5, '2']) assert.throws(() => n.knowledge({ ...query, id }), /positive integer/)
  }
  n.close()
  n = new PersonalNotes(directory, directory)
  assert.equal(n.knowledge({ area: 'lessons', action: 'history', id: lesson.id }).events.length, 2)
  n.close()
})


test('knowledge rejects a missing area with actionable guidance and no write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-knowledge-area-'))
  const notes = new PersonalNotes(directory, directory)
  const args = { action: 'save', key: 'drink', text: 'Synthetic preference', sourceReference: 'qa/area' }
  assert.throws(() => notes.knowledge(args), /requires area:.*No changes were saved/)
  assert.equal(notes.knowledge({ area: 'profile', action: 'list' }).total, 0)
  assert.ok(notes.knowledge({ ...args, area: 'profile' }).fact.id)
  notes.close()
})
