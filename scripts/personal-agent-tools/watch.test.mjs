import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalWatch } from './watch.mjs'

test('workspace watches report actual file changes and stop cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-personal-watch-test-'))
  const watch = new PersonalWatch(root)
  try {
    const entry = await watch.call({ action: 'start', path: '.' })
    await writeFile(join(root, 'canary.txt'), 'Synthetic canary')
    let events = []
    for (let attempt = 0; attempt < 250 && !events.length; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20))
      events = (await watch.call({ action: 'events', id: entry.id })).events
    }
    assert.ok(events.some(event => event.name === 'canary.txt'))
    await watch.call({ action: 'stop', id: entry.id })
    assert.deepEqual(await watch.call({ action: 'list' }), [])
  } finally { watch.shutdown() }
})

test('a symlink cannot widen the configured watch root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-personal-watch-test-'))
  const outside = await mkdtemp(join(tmpdir(), 'atomic-personal-watch-outside-'))
  await mkdir(join(root, 'inside'))
  await symlink(outside, join(root, 'escape'))
  const watch = new PersonalWatch(root)
  await assert.rejects(watch.call({ action: 'start', path: 'escape' }), /outside/)
  assert.deepEqual(await watch.call({ action: 'list' }), [])
})

test('persistent watch restores the same id and stop removes its definition', async () => {
  const { PersonalStore } = await import('./store.mjs')
  const root = await mkdtemp(join(tmpdir(), 'atomic-watch-persistent-'))
  const store = new PersonalStore(join(root, 'state'))
  const first = new PersonalWatch(root, store)
  const entry = await first.call({ action: 'start', path: '.', persistent: true })
  first.shutdown()
  const next = new PersonalWatch(root, store)
  try {
    await next.restore()
    assert.equal((await next.call({ action: 'list' }))[0].id, entry.id)
    await next.call({ action: 'stop', id: entry.id })
    assert.deepEqual(await store.watchDefinition('list'), [])
  } finally { next.shutdown() }
})
