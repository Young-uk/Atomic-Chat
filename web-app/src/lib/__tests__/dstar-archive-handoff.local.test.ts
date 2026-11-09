import { readFile, readdir } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { archiveStore } from '../dstar-context-archive'
import { ContextCompaction } from '../dstar-context-compaction'
import { convertThreadMessagesToUIMessages } from '../messages'

const fixture = vi.hoisted(() => ({ archives: [] as string[] }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => fixture.archives }))

/** Opt-in local diagnostic: reads the user's persisted transcript and archives,
 * runs the real projection, and prints counts only. No model calls or disk writes. */
it.skipIf(!process.env.ATOMIC_HANDOFF_DIAGNOSTIC_DIR || !process.env.ATOMIC_HANDOFF_DIAGNOSTIC_SCOPE)(
  'adopts a source-matching completed handoff after a local engine update without inference', async () => {
    const directory = process.env.ATOMIC_HANDOFF_DIAGNOSTIC_DIR!
    const scope = process.env.ATOMIC_HANDOFF_DIAGNOSTIC_SCOPE!
    const thread = directory.split('/').at(-1)!
    fixture.archives = await Promise.all((await readdir(`${directory}/context-archives`))
      .filter(name => name.endsWith('.json')).map(name => readFile(`${directory}/context-archives/${name}`, 'utf8')))
    const persisted = (await readFile(`${directory}/messages.jsonl`, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    const messages = convertThreadMessagesToUIMessages(persisted)
    const coordinator = new ContextCompaction(thread, archiveStore(scope))
    await coordinator.initialize()
    const projected = coordinator.apply(messages)
    const handoff = projected.find(message => message.id.startsWith('atomic-context-'))
    expect(handoff).toBeDefined()
    expect(projected.length).toBeLessThan(messages.length)
    const original = fixture.archives.map(value => JSON.parse(value))
      .find(record => `atomic-context-${record.id}` === handoff!.id)
    expect(original.runtimeScope).not.toBe(scope)
    expect(messages.slice(0, original.source.length).map(message => message.id)).toEqual(original.source.map((message: { id: string }) => message.id))
    console.info('[handoff-diagnostic]', { rawMessages: messages.length, archivedMessages: original.source.length,
      projectedMessages: projected.length, adoptedPreviousEngineHandoff: true, modelRequests: 0 })
  })
