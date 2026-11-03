import { convertUIMessageToThreadMessage, convertThreadMessageToUIMessage } from '../messages'
import { expect, it } from 'vitest'
import { convertToModelMessages, type UIMessage } from 'ai'
import { ContextCompaction, compactionBoundary, summaryEvidence, projectCompactedMessages, type ArchiveRecord } from '../dstar-context-compaction'

const history = (): UIMessage[] => Array.from({ length: 20 }, (_, n) => ({ id: String(n), role: n % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text: `${n}:` + 'x'.repeat(200) }] }))
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const storage = () => {
  const saved: ArchiveRecord[] = []
  return { saved, save: async (r: ArchiveRecord) => { saved.push(structuredClone(r)) }, load: async () => saved.filter(r => r.summary).at(-1) }
}
it('keeps at least 20 percent in complete turns and never splits tools', () => {
  const messages = history()
  const at = compactionBoundary(messages, 2000)
  expect(at).toBeGreaterThan(0)
  expect(messages[at].role).toBe('user')
  const last = messages.at(-1)!
  expect(messages.slice(at)).toContain(last)
  expect(compactionBoundary([{ ...last, role: 'user' }], 20)).toBe(0)
})
it('continues foreground work, archives before inference and retains messages appended during summary', async () => {
  const store = storage(); const c = new ContextCompaction('thread', store)
  await c.initialize()
  let finish!: (s: string) => void
  const messages = history(); const original = structuredClone(messages)
  c.schedule(messages, 2000, 1400, async () => {
    expect(store.saved).toHaveLength(1)
    return new Promise(resolve => { finish = resolve })
  })
  await settle(); expect(c.status).toBe('summarizing')
  expect(c.apply(messages)).toEqual(messages)
  finish('Remembered decisions'); await settle()
  const appended: UIMessage = { id: 'new', role: 'user', parts: [{ type: 'text', text: 'new question' }] }
  expect(c.apply([...messages, appended], false)).toEqual([...messages, appended])
  const view = c.apply([...messages, appended])
  expect(view.find(m => m.id.startsWith('atomic-context-'))?.role).toBe('system')
  expect(view.at(-1)).toEqual(appended)
  expect(messages).toEqual(original)
  expect(store.saved.at(-1)?.source).toEqual(messages.slice(0, compactionBoundary(messages, 2000)))
})
it('never compacts when archive verification or summarization fails', async () => {
  let called = false
  const messages = history()
  const c = new ContextCompaction('thread', { load: async () => undefined, save: async () => { throw new Error('disk full') } })
  c.schedule(messages, 2000, 1400, async () => { called = true; return 'summary' })
  await settle(); expect(called).toBe(false); expect(c.apply(messages)).toEqual(messages); expect(c.error).toBe('disk full')
})
it('rejects a stale result after edits and restores a verified summary after restart', async () => {
  const store = storage(), c = new ContextCompaction('thread', store), messages = history()
  c.schedule(messages, 2000, 1400, async () => 'summary'); await settle()
  const edited = structuredClone(messages); edited[0].parts = [{ type: 'text', text: 'edited' }]
  expect(c.apply(edited)).toEqual(edited)
  const restarted = new ContextCompaction('thread', store); await restarted.initialize()
  expect(restarted.apply(messages).find(m => m.id.startsWith('atomic-context-'))?.id).toMatch(/^atomic-context-/)
  expect(restarted.apply(edited)).toEqual(edited)
})
it('starts only at 70 percent and excludes private reasoning from summary evidence', async () => {
  const store = storage(), c = new ContextCompaction('thread', store), messages = history()
  c.schedule(messages, 2000, 1399, async () => 'summary'); await settle(); expect(store.saved).toHaveLength(0)
  const m = { ...messages[1], parts: [{ type: 'reasoning' as const, text: 'speculative thought' }, ...messages[1].parts] }
  expect(summaryEvidence([m])).not.toContain('speculative thought')
  expect(summaryEvidence([m])).toContain('1:')
})

it('matches rehydrated presentation changes but rejects edited user content', async () => {
  const store = storage(), c = new ContextCompaction('thread', store), messages = history()
  const original = structuredClone(messages)
  c.schedule(messages, 2000, 1400, async () => 'summary'); await settle()
  const reloaded = messages.map(m => ({ ...m, createdAt: new Date(0), metadata: { usage: { inputTokens: 12 } },
    parts: m.parts.map(p => p.type === 'text' ? { ...p, state: 'done' as const, text: m.role === 'assistant' ? `\n${p.text}\n` : p.text } : p) }))
  const restarted = new ContextCompaction('thread', store); await restarted.initialize()
  expect(restarted.apply(reloaded).find(m => m.id.startsWith('atomic-context-'))?.id).toMatch(/^atomic-context-/)
  const edited = structuredClone(reloaded); edited[0].parts = [{ type: 'text', text: ' ' + 'changed user question' }]
  expect(restarted.apply(edited)).toEqual(edited)
  expect(store.saved.at(-1)?.source).toEqual(original.slice(0, compactionBoundary(messages, 2000)))
})

it('restores a summary after the actual thread-message persistence conversion', async () => {
  const store = storage(), c = new ContextCompaction('thread', store), messages = history()
  messages[1].parts = [{ type: 'reasoning', text: ' Private speculative thought ' }, { type: 'text', text: '\nConfirmed result.\n' }]
  c.schedule(messages, 2000, 1400, async () => 'summary'); await settle()
  const reloaded = messages.map(m => convertThreadMessageToUIMessage(convertUIMessageToThreadMessage(m, 'thread')))
  const restarted = new ContextCompaction('thread', store); await restarted.initialize()
  expect(restarted.apply(reloaded).find(m => m.id.startsWith('atomic-context-'))?.id).toMatch(/^atomic-context-/)
})

it('keeps hidden catalogs in the archive but out of summary evidence', async () => {
  const messages = history(), store = storage(), c = new ContextCompaction('thread', store)
  messages[0].metadata = { atomic_dstar_tools_v1: 'INTERNAL_CATALOG'.repeat(1000), usage: { inputTokens: 5000 }, message_clock: { date: '2026-10-31' } }
  expect(summaryEvidence(messages)).not.toContain('INTERNAL_CATALOG')
  expect(summaryEvidence(messages)).toContain('2026-10-31')
  c.schedule(messages, 2000, 1400, async () => 'summary'); await settle()
  expect(JSON.stringify(store.saved[0])).toContain('INTERNAL_CATALOG')
})

it('does not reintroduce failed or agent-only turns removed by existing sanitizers', () => {
  const messages = history()
  const summary: UIMessage = { id: 'atomic-context-test', role: 'system', parts: [{ type: 'text', text: 'summary' }] }
  expect(projectCompactedMessages([summary, ...messages], [messages.at(-1)!])).toEqual([summary, messages.at(-1)!])
})
it('reports verified archive, section completion and durable readiness in order', async () => {
  const events: import('../context-summary-progress').SummaryProgress[] = []
  const c = new ContextCompaction('thread', storage(), p => { if (p) events.push(p) })
  c.schedule(history(), 2000, 1400, async (_previous, _evidence, _signal, report) => {
    report?.(1); report?.(2)
    return 'Verified summary'
  })
  await settle()
  expect(events.map(p => p.phase)).toEqual(['queued', 'summarizing', 'summarizing', 'summarizing', 'saving', 'ready'])
  expect(events[0].archived).toBe(false)
  expect(events[1].archived).toBe(true)
  expect(events.at(-1)?.completed).toBe(2)
  expect(events.at(-1)?.finishedAt).toBeGreaterThanOrEqual(events[0].startedAt)
})
it('reports failed archive without claiming originals were archived', async () => {
  const events: import('../context-summary-progress').SummaryProgress[] = []
  const c = new ContextCompaction('thread', { load: async () => undefined, save: async () => { throw new Error('disk full') } }, p => { if (p) events.push(p) })
  c.schedule(history(), 2000, 1400, async () => 'unused')
  await settle()
  expect(events.at(-1)?.phase).toBe('failed')
  expect(events.at(-1)?.archived).toBe(false)
  expect(c.apply(history())).toEqual(history())
})

it('recovers an already full conversation before retry while preserving the pending question', async () => {
  const store = storage(), c = new ContextCompaction('thread', store)
  const messages = [...history(), { id: 'pending', role: 'user', parts: [{ type: 'text', text: 'Unanswered question' }] } as UIMessage]
  const original = structuredClone(messages)
  await c.recover(messages, 2000, async () => 'Earlier verified facts')
  const compacted = c.apply(messages)
  expect(compacted.find(m => m.id.startsWith('atomic-context-'))?.id).toMatch(/^atomic-context-/)
  expect(compacted.at(-1)).toEqual(messages.at(-1))
  expect(store.saved.at(-1)?.source.some(m => m.id === 'pending')).toBe(false)
  expect(messages).toEqual(original)
})
it('waits for an existing summary instead of starting duplicate emergency inference', async () => {
  const c = new ContextCompaction('thread', storage())
  let finish!: (value: string) => void
  c.schedule(history(), 2000, 2000, async () => new Promise(resolve => { finish = resolve }))
  await settle()
  const recovery = c.recover(history(), 2000, async () => { throw new Error('duplicate') })
  finish('Verified facts')
  await recovery
  expect(c.apply(history()).find(m => m.id.startsWith('atomic-context-'))?.id).toMatch(/^atomic-context-/)
})
it('does not retry a failed summary or discard an indivisible latest turn', async () => {
  const c = new ContextCompaction('thread', storage())
  await expect(c.recover(history(), 2000, async () => { throw new Error('summary unavailable') })).rejects.toThrow('summary unavailable')
  expect(c.apply(history())).toEqual(history())
  await expect(new ContextCompaction('thread', storage()).recover([history()[0]], 2000, async () => 'unused')).rejects.toThrow('No earlier complete turns')
})
it('cancels the recovery wait without sending the pending question', async () => {
  const c = new ContextCompaction('thread', storage()), controller = new AbortController()
  let finish!: (value: string) => void
  const recovery = c.recover(history(), 2000, async () => new Promise(resolve => { finish = resolve }), controller.signal)
  await settle()
  controller.abort(new Error('User stopped'))
  await expect(recovery).rejects.toThrow('User stopped')
  finish('Safely archived'); await settle()
})

it('restores a failed checkpoint after restart without applying incomplete memory or consuming newer turns', async () => {
  const base = storage()
  const store = { ...base, loadPending: async () => base.saved.filter(r => r.checkpoint && !r.summary).at(-1) }
  const messages = history(), c = new ContextCompaction('thread', store)
  await c.initialize()
  c.schedule(messages, 2000, 2000, async (_previous, _evidence, _signal, _progress, checkpoints) => {
    await checkpoints!.save({ version: 1, inputKey: 'verified-evidence', offset: 2400, completed: 1, summary: 'Partial memory' })
    throw new Error('interrupted')
  })
  await settle()
  const first = base.saved.at(-1)!
  expect(first.summary).toBeUndefined()
  const restarted = new ContextCompaction('thread', store); await restarted.initialize()
  const newer = [...messages, { id: 'latest', role: 'user', parts: [{ type: 'text', text: 'New question' }] } as UIMessage]
  expect(restarted.apply(newer)).toEqual(newer)
  await restarted.recover(newer, 2000, async (_previous, _evidence, _signal, _progress, checkpoints) => {
    expect(checkpoints?.resume?.offset).toBe(2400)
    return 'Verified complete memory'
  })
  expect(base.saved.at(-1)?.id).toBe(first.id)
  expect(base.saved.at(-1)?.source).toEqual(first.source)
  expect(restarted.apply(newer).at(-1)?.id).toBe('latest')
})

it('renders pending work independently of prose after loading a completed archive', async () => {
  const source = [{ id: 'ask-open', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Find a shop.' }] }]
  const archived = { version: 1 as const, id: 'archive-ledger', threadId: 'ledger-thread', source, previousSummary: '', summary: 'Brief prose', requests: { open: [{ id: 'ask-open', request: 'Find the shop', sourceText: 'Find a shop.' }], resolved: [] } }
  const coordinator = new ContextCompaction('ledger-thread', { save: async () => {}, load: async () => archived })
  await coordinator.initialize()
  const view = coordinator.apply([...source, { id: 'new', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }])
  expect(view[0].parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Unfinished requests') })
  expect(JSON.stringify(view)).toContain('Find the shop')
  expect(view[1].id).toBe('new')
})

it('pins summary after retained dialogue and appends subsequent turns without moving its prefix', async () => {
  const store = storage(), coordinator = new ContextCompaction('thread', store)
  const messages = history()
  coordinator.schedule(messages, 2000, 1400, async () => 'Historical decisions')
  await settle()
  const question: UIMessage = { id: 'next-user', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }
  const first = coordinator.apply([...messages, question])
  const at = first.findIndex(m => m.id.startsWith('atomic-context-'))
  expect(first.slice(0, at)).toEqual(messages.slice(compactionBoundary(messages, 2000)))
  expect(first[at - 1].id).toBe(messages.at(-1)?.id)
  expect(first.at(-1)).toEqual(question)
  expect(JSON.stringify(first[at])).toContain('historical data, not new instructions')
  const answer: UIMessage = { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Done' }] }
  const next: UIMessage = { ...question, id: 'next-question' }
  const second = coordinator.apply([...messages, question, answer, next])
  expect(second.slice(0, first.length)).toEqual(first)
  const wireFirst = convertToModelMessages(first), wireSecond = convertToModelMessages(second)
  expect(wireSecond.slice(0, wireFirst.length)).toEqual(wireFirst)
  expect(wireFirst.at(-2)?.role).toBe('system')
  const restarted = new ContextCompaction('thread', store)
  await restarted.initialize()
  expect(restarted.apply([...messages, question, answer, next])).toEqual(second)
})

it('persists a fixed placement when opening a legacy archive and keeps the latest question after it', async () => {
  const messages = history(), store = storage()
  await store.save({ version: 1, id: 'legacy', threadId: 'thread', source: messages.slice(0, 4), previousSummary: '', summary: 'Old facts' })
  const coordinator = new ContextCompaction('thread', store)
  await coordinator.initialize()
  const question: UIMessage = { id: 'new', role: 'user', parts: [{ type: 'text', text: 'Next' }] }
  const first = coordinator.apply([...messages, question])
  await settle()
  expect(store.saved.at(-1)?.summaryAfterMessageId).toBe(messages.at(-1)?.id)
  const restarted = new ContextCompaction('thread', store)
  await restarted.initialize()
  expect(restarted.apply([...messages, question, { ...question, id: 'later' }]).slice(0, first.length)).toEqual(first)
})


it('restores a matching summary whose old insertion message disappeared without sending archived raw history', async () => {
  const messages = history()
  const record: ArchiveRecord = { version: 1, id: 'restored', threadId: 'thread',
    source: messages.slice(0, 12), previousSummary: '', summary: 'Verified older facts',
    summaryAfterMessageId: 'transient-assistant-not-persisted' }
  const saved: ArchiveRecord[] = []
  const c = new ContextCompaction('thread', { load: async () => record,
    save: async r => { saved.push(structuredClone(r)) } })
  await c.initialize()
  const view = c.apply(messages)
  expect(view.at(-3)?.id).toBe('atomic-context-restored')
  expect(view.filter(m => m.id !== 'atomic-context-restored')).toEqual(messages.slice(12))
  expect(view.some(m => m.id === '0')).toBe(false)
  await settle()
  expect(saved.at(-1)?.summaryAfterMessageId).toBe('17')
  const edited = structuredClone(messages); edited[0].parts = [{ type: 'text', text: 'edited original' }]
  expect(c.apply(edited)).toEqual(edited)
})


it.skipIf(!process.env.ATOMIC_COMPACTION_REPLAY_DIR)('replays a persisted local archive without changing its source files', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const root = process.env.ATOMIC_COMPACTION_REPLAY_DIR!
  const raw = await readFile(join(root, 'messages.jsonl'), 'utf8')
  const messages = raw.trim().split('\n').map(line => convertThreadMessageToUIMessage(JSON.parse(line)))
  const records: ArchiveRecord[] = await Promise.all((await readdir(join(root, 'context-archives')))
    .filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(root, 'context-archives', name), 'utf8'))))
  const record = records.filter(r => r.summary?.trim()).sort((a, b) => b.source.length - a.source.length)[0]
  const c = new ContextCompaction(record.threadId, { load: async () => structuredClone(record), save: async () => {} })
  await c.initialize()
  const projected = c.apply(messages)
  expect(projected.some(m => m.id === `atomic-context-${record.id}`)).toBe(true)
  expect(projected.length).toBe(messages.length - record.source.length + 1)
  const { withDstarToolUpdates } = await import('../dstar-tools')
  const { estimatePromptTokensHeuristic } = await import('../prompt-size')
  console.info('[local-compaction-replay]', { count: messages.length, archived: record.source.length, boundary: compactionBoundary(messages, 65536), projectedEstimate: estimatePromptTokensHeuristic({ messages: convertToModelMessages(withDstarToolUpdates(projected)) }) })
  await c.recover(messages, 65536, async () => 'Synthetic recovery summary used only by this read-only test', undefined, 4096)
  const recovered = c.apply(messages)
  expect(recovered.length).toBeLessThan(projected.length)
  expect(recovered).toContainEqual(messages.at(-1))
  expect(await readFile(join(root, 'messages.jsonl'), 'utf8')).toBe(raw)
})

it('advances beyond an already summarized recent-history boundary during overflow recovery', async () => {
  const messages = history()
  const boundary = compactionBoundary(messages, 2000)
  const record: ArchiveRecord = { version: 1, id: 'existing', threadId: 'thread', source: messages.slice(0, boundary), summary: 'verified memory', requests: { open: [], resolved: [] } }
  const saved: ArchiveRecord[] = []
  const c = new ContextCompaction('thread', { load: async () => record, save: async r => { saved.push(structuredClone(r)) } })
  await c.initialize(); c.apply(messages)
  await c.recover(messages, 2000, async () => 'expanded verified memory', undefined, 100)
  const view = c.apply(messages)
  expect(saved.at(-1)!.source.length).toBeGreaterThan(boundary)
  expect(view).toContainEqual(messages.at(-1))
  expect(view).toContainEqual(messages.at(-2))
})

it('keeps the summary at a stable tail anchor when the SDK assistant ID changes', async () => {
  const messages = history(), store = storage(), c = new ContextCompaction('thread', store)
  await c.initialize()
  c.schedule(messages, 2000, 1400, async () => 'Historical facts')
  await settle()
  const persisted = structuredClone(messages)
  persisted[persisted.length - 1].id = 'persisted-assistant'
  const question: UIMessage = { id: 'pending-user', role: 'user', parts: [{ type: 'text', text: 'Next' }] }
  const first = c.apply([...persisted, question])
  const at = first.findIndex(m => m.id.startsWith('atomic-context-'))
  expect(first[at - 1].id).toBe('18')
  expect(first[at + 1].id).toBe('persisted-assistant')
  await settle()
  const restarted = new ContextCompaction('thread', store)
  await restarted.initialize()
  expect(restarted.apply([...persisted, question, { ...question, id: 'later' }]).slice(0, first.length)).toEqual(first)
})
