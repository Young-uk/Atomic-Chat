import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PersonalChatHistory } from './chat-history.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'atomic-chat-history-'))
  const threadsRoot = join(root, 'threads'), directory = join(root, 'index')
  await mkdir(threadsRoot); await mkdir(directory)
  const history = new PersonalChatHistory({ directory, threadsRoot, now: () => Date.parse('2026-11-14T01:00:00+09:00') })
  t.after(async () => { history.close(); await rm(root, { recursive: true, force: true }) })
  const write = async (id, rows, { assistant = 'winter', project, title = id } = {}) => {
    const path = join(threadsRoot, id); await mkdir(path, { recursive: true })
    await writeFile(join(path, 'thread.json'), JSON.stringify({ id, title, assistants: [{ id: assistant }], metadata: project ? { project: { id: project } } : {} }))
    await writeFile(join(path, 'messages.jsonl'), rows.map(row => JSON.stringify({ thread_id: id, ...row })).join('\n') + '\n')
  }
  await write('room-two', [message('current', 'user', 'What did I say yesterday?', '2026-11-13T16:00:00Z')])
  const call = args => history.call({ ...args, originThreadId: 'room-two', originTimeZone: 'Asia/Seoul' })
  return { root, threadsRoot, history, write, call }
}
function message(id, role, text, time = '2026-11-12T15:30:00Z') {
  return { id, role, created_at: Date.parse(time), content: [{ type: 'text', text: { value: text } }] }
}

test('finds another room and returns the following correction, with provenance and no private parts', async t => {
  const f = await fixture(t)
  const first = message('outfit', 'user', '오늘은 추운데 얇게 입어야지!')
  first.content.push({ type: 'reasoning', text: { value: 'PRIVATE-REASONING-CANARY' } }, { type: 'tool_call', text: { value: 'PRIVATE-TOOL-CANARY' } })
  await f.write('room-one', [first, message('reply', 'assistant', '겉옷도 챙길까요?'), message('correction', 'user', '아니다. 두껍게 입을래.')], { title: 'Yesterday weather' })
  const found = await f.call({ action: 'search', query: '추운데 얇게', day: 'yesterday', withContext: true })
  assert.equal(found.context.threadId, 'room-one')
  assert.equal(found.context.messages[2].text, '아니다. 두껍게 입을래.')
  assert.equal(found.scope, 'same-assistant-and-project')
  assert.equal(found.day, '2026-11-13')
  assert.equal(found.hits[0].messageId, 'outfit')
  assert.equal(found.hits[0].title, 'Yesterday weather')
  assert.match(found.hits[0].source, /historyMessage=outfit/)
  const context = await f.call({ action: 'context', threadId: 'room-one', messageId: 'outfit' })
  assert.deepEqual(context.messages.map(row => row.id), ['outfit', 'reply', 'correction'])
  assert.equal(context.messages[2].text, '아니다. 두껍게 입을래.')
  assert.deepEqual(await readdir(join(f.root, 'index')), [])
  assert.doesNotMatch(JSON.stringify([found, context]), /PRIVATE-/)
})

test('excludes current room, different assistants and different projects, including direct context reads', async t => {
  const f = await fixture(t)
  await f.write('room-one', [message('allowed', 'user', 'weather jacket')])
  await f.write('other-assistant', [message('other', 'user', 'weather hidden')], { assistant: 'other' })
  await f.write('other-project', [message('project', 'user', 'weather hidden')], { project: 'private' })
  await f.write('room-two', [message('self', 'user', 'weather current')])
  const found = await f.call({ action: 'search', query: 'weather' })
  assert.deepEqual(found.hits.map(row => row.threadId), ['room-one'])
  await assert.rejects(f.call({ action: 'context', threadId: 'other-assistant', messageId: 'other' }), /scope/)
  await assert.rejects(f.call({ action: 'context', threadId: 'other-project', messageId: 'project' }), /scope/)
  await f.write('room-one', [message('allowed', 'user', 'weather jacket')], { assistant: 'changed' })
  assert.deepEqual((await f.call({ action: 'search', query: 'weather' })).hits, [])
})

test('refreshes edits, message deletion and room deletion, never resurrecting immutable archives', async t => {
  const f = await fixture(t)
  await f.write('room-one', [message('outfit', 'user', 'thin-outfit')])
  assert.equal((await f.call({ action: 'search', query: 'thin-outfit' })).hits.length, 1)
  const archives = join(f.threadsRoot, 'room-one', 'context-archives'); await mkdir(archives)
  await writeFile(join(archives, 'old.json'), JSON.stringify({ source: [message('outfit', 'user', 'thin-outfit')] }))
  await f.write('room-one', [message('outfit', 'user', 'thick-coat-updated')])
  assert.deepEqual((await f.call({ action: 'search', query: 'thin' })).hits, [])
  assert.equal((await f.call({ action: 'search', query: 'updated' })).hits.length, 1)
  await f.write('room-one', [])
  assert.deepEqual((await f.call({ action: 'search', query: 'updated' })).hits, [])
  await assert.rejects(f.call({ action: 'context', threadId: 'room-one', messageId: 'outfit' }), /no longer exists/)
  await f.write('room-one', [message('new', 'user', 'weather')])
  assert.equal((await f.call({ action: 'search', query: 'weather' })).hits.length, 1)
  await rm(join(f.threadsRoot, 'room-one'), { recursive: true })
  assert.deepEqual((await f.call({ action: 'search', query: 'weather' })).hits, [])
  assert.equal(f.history.database().prepare('SELECT count(*) AS n FROM history_messages').get().n, 1)
})

test('uses local calendar days across UTC midnight and labels date-only fallback explicitly', async t => {
  const f = await fixture(t)
  await f.write('room-one', [message('yesterday', 'user', 'weather', '2026-11-12T15:30:00Z'), message('today', 'user', 'weather', '2026-11-13T15:30:00Z')])
  assert.deepEqual((await f.call({ action: 'search', query: 'weather', day: 'yesterday' })).hits.map(row => row.messageId), ['yesterday'])
  assert.deepEqual((await f.call({ action: 'search', query: 'weather', day: 'today' })).hits.map(row => row.messageId), ['today'])
  const fallback = await f.call({ action: 'search', query: 'unrelated-keyword', day: 'yesterday' })
  assert.equal(fallback.matchMode, 'date-only-fallback')
  assert.equal(fallback.hits[0].messageId, 'yesterday')
  await assert.rejects(f.call({ action: 'search', query: 'weather', day: '2026-02-30' }), /day/)
})

test('pages search and context without silently replacing the source or changing keyword mode at the end', async t => {
  const f = await fixture(t)
  await f.write('room-one', Array.from({ length: 6 }, (_, i) => message(`m${i}`, 'user', `weather ${i} ${'x'.repeat(1900)}`)))
  const page = await f.call({ action: 'search', query: 'weather', day: 'yesterday', limit: 2 })
  assert.equal(page.hits.length, 2); assert.equal(page.nextOffset, 2); assert.equal(page.hits[0].truncated, true)
  const end = await f.call({ action: 'search', query: 'weather', day: 'yesterday', limit: 2, offset: 6 })
  assert.equal(end.matchMode, 'keywords'); assert.deepEqual(end.hits, [])
  const context = await f.call({ action: 'context', threadId: 'room-one', messageId: 'm2', before: 1, after: 1 })
  assert.deepEqual(context.messages.map(row => row.id), ['m1', 'm2', 'm3'])
  assert.equal(context.hasEarlier, true); assert.equal(context.hasLater, true); assert.equal(context.messages[0].truncated, true)
  const next = await f.call({ action: 'context', threadId: 'room-one', messageId: 'm2', before: 0, after: 0, textOffset: context.messages[1].nextTextOffset })
  assert.equal(next.messages[0].nextTextOffset, null)
  assert.equal(next.messages[0].textOffset, context.messages[1].nextTextOffset)
  await assert.rejects(f.call({ action: 'search', query: 'weather', limit: 0 }), /positive/)
})

test('rejects forged paths and symlink sources; query operators cannot widen scope', async t => {
  const f = await fixture(t)
  await f.write('room-one', [message('safe', 'user', 'weather')])
  await assert.rejects(f.call({ action: 'context', threadId: '../room-one', messageId: 'safe' }), /Invalid/)
  await assert.rejects(f.history.call({ action: 'search', query: 'weather', originThreadId: 'missing', originTimeZone: 'Asia/Seoul' }))
  await symlink(join(f.threadsRoot, 'room-one'), join(f.threadsRoot, 'linked'))
  assert.equal((await f.call({ action: 'search', query: 'weather' })).hits.length, 1)
  await assert.rejects(f.call({ action: 'context', threadId: 'linked', messageId: 'safe' }), /directory/)
  await rm(join(f.threadsRoot, 'room-one', 'messages.jsonl'))
  await writeFile(join(f.root, 'outside.jsonl'), JSON.stringify(message('secret', 'user', 'OUTSIDE-CANARY')))
  await symlink(join(f.root, 'outside.jsonl'), join(f.threadsRoot, 'room-one', 'messages.jsonl'))
  const found = await f.call({ action: 'search', query: '" OR OUTSIDE-CANARY' })
  assert.deepEqual(found.hits, []); assert.ok(found.unavailableThreads.includes('room-one'))
})

test('anchors yesterday to the user turn when tool execution crosses midnight', async t => {
  const f = await fixture(t)
  await f.write('room-two', [message('current', 'user', 'Yesterday weather?', '2026-11-13T14:59:00Z')])
  await f.write('room-one', [message('earlier', 'user', 'weather', '2026-11-12T02:00:00Z')])
  const result = await f.call({ action: 'search', query: 'weather', day: 'yesterday' })
  assert.equal(result.day, '2026-11-12')
  assert.equal(result.hits[0].messageId, 'earlier')
})
