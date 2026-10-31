import { transferableAbortController } from 'node:util'
import { expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import type { UIMessage } from 'ai'
import { ContextCompaction } from '../dstar-context-compaction'
import { archiveStore, searchConversationArchive, summarizeWithDstar } from '../dstar-context-archive'
const files = vi.hoisted(() => ({ root: '/private/tmp/atomic-summary-slot-oct31/archives' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (_: string, a: { threadId: string; name?: string; data?: string }) => {
  const dir = `${files.root}/${a.threadId}`
  await mkdir(dir, { recursive: true })
  if (a.name && a.data) {
    await writeFile(`${dir}/${a.name}`, a.data)
    expect(await readFile(`${dir}/${a.name}`, 'utf8')).toBe(a.data)
    return []
  }
  return Promise.all((await readdir(dir)).filter(n => n.endsWith('.json')).map(n => readFile(`${dir}/${n}`, 'utf8')))
} }))
it.skipIf(process.env.DSTAR_COMPACTION_LIVE !== 'true')('summarizes in the background, preserves new turns and restores searchable originals', async () => {
  // Node fetch requires Node signals; jsdom's same-named class is a
  // different realm. Use native constructors only in this live harness.
  const nativeController = transferableAbortController()
  vi.stubGlobal('AbortController', nativeController.constructor)
  vi.stubGlobal('AbortSignal', nativeController.signal.constructor)
  const thread = `synthetic-${Date.now()}`
  const messages: UIMessage[] = Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user',
    metadata: { message_clock: { date: '2026-10-31', time: `02:${String(i).padStart(2, '0')}:00` } },
    parts: [{ type: 'text', text: i === 0 ? 'Confirmed: the project name is MAPLE_CANARY and the user prefers Korean. ' + 'These are project notes. '.repeat(30) : `Note ${i}: Original records must be preserved; only model context is summarized. ` + 'Keep decisions and unresolved work. '.repeat(20) }] }))
  const c = new ContextCompaction(thread, archiveStore())
  await c.initialize()
  c.schedule(messages, 8192, 6000, summarizeWithDstar('http://127.0.0.1:8011/v1', 'qwen3.8-flash-next-chat'))
  expect(c.status).toBe('summarizing')
  expect(c.apply(messages)).toEqual(messages)
  const extra: UIMessage = { id: 'new-during-summary', role: 'user', parts: [{ type: 'text', text: 'Preserve this new question.' }] }
  const deadline = Date.now() + 240_000
  while (c.status === 'summarizing' && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
  expect(c.error).toBeUndefined()
  expect(c.status).toBe('ready')
  const view = c.apply([...messages, extra])
  expect(JSON.stringify(view[0])).toContain('MAPLE_CANARY')
  expect(view.at(-1)).toEqual(extra)
  expect(view.length).toBeLessThan(messages.length)
  const restarted = new ContextCompaction(thread, archiveStore())
  await restarted.initialize()
  expect(restarted.apply([...messages, extra])).toEqual(view)
  const hits = await searchConversationArchive(thread, 'MAPLE_CANARY')
  expect(hits.length).toBeGreaterThan(0)
  expect(hits[0].excerpt).toContain('MAPLE_CANARY')
  await writeFile('/private/tmp/atomic-summary-slot-oct31/compaction-result.json', JSON.stringify({ thread, originalMessages: messages.length, modelMessages: view.length, summary: view[0], archiveHits: hits }, null, 2))
}, 260_000)
