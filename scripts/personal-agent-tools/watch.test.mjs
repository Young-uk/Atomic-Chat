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
