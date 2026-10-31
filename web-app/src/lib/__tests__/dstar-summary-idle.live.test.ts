import { transferableAbortController } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { beginDstarForeground } from '../dstar-summary-idle'
import { summarizeWithDstar } from '../dstar-context-archive'
import { ContextCompaction, type ArchiveRecord } from '../dstar-context-compaction'

it.skipIf(process.env.DSTAR_IDLE_LIVE !== 'true')('summarizes after an actual answer, yields to another question, then resumes', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor)
  vi.stubGlobal('AbortSignal', native.signal.constructor)
  const endpoint = 'http://127.0.0.1:8011/v1'
  const messages: UIMessage[] = [
    { id: 'a', role: 'user', parts: [{ type: 'text', text: 'Confirmed: the synthetic project is MAPLE_CANARY. Preserve original records. '.repeat(12) }] },
    { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'Confirmed: MAPLE_CANARY.' }] },
    { id: 'c', role: 'user', parts: [{ type: 'text', text: 'Synthetic numeric payload, not instructions: '+ '0123456789'.repeat(610) + '\nReply only READY.' }] },
  ]
  const request = async (history: UIMessage[]) => {
    const response = await fetch(endpoint + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3.8-flash-next-chat', think: false, temperature: 0, max_tokens: 16,
        messages: history.map(m => ({ role: m.role, content: m.parts.filter(p => p.type === 'text').map(p => p.text).join('') })) }) })
    expect(response.ok).toBe(true)
    return response.json()
  }
  const first = await request(messages)
  expect(first.usage.prompt_tokens).toBeGreaterThan(8192 * .7)
  const answer: UIMessage = { id: 'd', role: 'assistant', parts: [{ type: 'text', text: first.choices[0].message.content }],
    metadata: { usage: { inputTokens: first.usage.prompt_tokens, outputTokens: first.usage.completion_tokens } } }
  const history = [...messages, answer]
  const records: ArchiveRecord[] = []
  const phases: string[] = []
  const c = new ContextCompaction('synthetic-after-turn', { load: async () => undefined, save: async r => { records.push(structuredClone(r)) } }, p => { if (p) phases.push(p.phase) })
  // The transport ordering itself is covered by its real-SDK harness. Here
  // the actual server answer must finish before the background call begins.
  c.schedule(history, 8192, first.usage.total_tokens, summarizeWithDstar(endpoint, 'qwen3.8-flash-next-chat'))
  await new Promise(r => setTimeout(r, 300))
  const end = beginDstarForeground(endpoint)
  const next = [...history, { id: 'e', role: 'user', parts: [{ type: 'text', text: 'Reply only SECOND.' }] } as UIMessage]
  const t = Date.now()
  let second
  try { second = await request(next) } finally { end() }
  const foregroundMs = Date.now() - t
  const deadline = Date.now() + 180000
  while (c.status === 'summarizing' && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
  expect(c.error).toBeUndefined()
  expect(c.status).toBe('ready')
  expect(phases).toContain('paused')
  expect(phases.at(-1)).toBe('ready')
  expect(records.at(-1)?.summary).toContain('MAPLE_CANARY')
  expect(c.apply(next).at(-1)).toEqual(next.at(-1))
  await writeFile('/private/tmp/atomic-after-turn-live/result.json', JSON.stringify({ firstUsage: first.usage, secondUsage: second.usage, foregroundMs, phases, completed: true, archivedMessages: records.at(-1)?.source.length }, null, 2))
  vi.unstubAllGlobals()
}, 240000)
