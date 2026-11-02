import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalNotes } from './notes.mjs'
import { PersonalMemoryLifecycle } from './memory-lifecycle.mjs'

const settled = async lifecycle => {
  for (let i = 0; i < 200; i++) {
    if (!lifecycle.active && !lifecycle.pending.length) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Memory lifecycle did not settle')
}

test('formation waits for idle, retains grounded evidence and does not duplicate a completed turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-memory-lifecycle-'))
  const notes = new PersonalNotes(directory, directory)
  let calls = 0
  const memory = new PersonalMemoryLifecycle({ directory, notes, complete: async () => {
    calls++
    return { content: 'SET name=Alice\nNOTE The user prefers jasmine tea every evening.' }
  } })
  try {
    const input = { sessionId: 'synthetic-thread', messageId: 'synthetic-answer', userMessage: 'My name is Alice. I prefer jasmine tea every evening.', assistantReply: 'I will remember your preference.' }
    memory.enqueue(input)
    assert.equal(calls, 0)
    memory.activity(false)
    await settled(memory)
    assert.equal(memory.profile.get('name').value, 'Alice')
    assert.ok(notes.call({ action: 'recall', query: 'How do I keep my notes?' }).entries.some(row => row.id.startsWith('profile:') && row.content === 'name: Alice'))
    assert.ok(notes.call({ action: 'search', query: 'jasmine' }).entries.some(note => note.content.includes('jasmine')))
    memory.enqueue(input)
    memory.activity(false)
    await settled(memory)
    assert.equal(calls, 1)
    assert.equal(memory.status().last.state, 'completed')
  } finally { await memory.close(); notes.close() }
})

test('new chat aborts background work, requeues it and refuses an invented user name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atomic-memory-priority-'))
  const notes = new PersonalNotes(directory, directory)
  let calls = 0
  const memory = new PersonalMemoryLifecycle({ directory, notes, complete: async params => {
    calls++
    if (calls === 1) return new Promise((_resolve, reject) => params.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    return { content: 'SET name=Mallory' }
  } })
  try {
    memory.enqueue({ sessionId: 'synthetic-thread', messageId: 'answer', userMessage: 'I maintain a garden and grow several kinds of roses.', assistantReply: 'Your garden sounds interesting.' })
    memory.activity(false)
    assert.equal(calls, 1)
    memory.activity(true)
    for (let i = 0; i < 200 && memory.active; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(memory.pending.length, 1)
    assert.equal(memory.status().phase, 'queued')
    memory.activity(false)
    await settled(memory)
    assert.equal(calls, 2)
    assert.equal(memory.profile.get('name'), null)
    assert.equal(memory.status().last.outcome, 'none')
  } finally { await memory.close(); notes.close() }
})
