import { transferableAbortController } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { summaryEvidence, type ArchiveRecord } from '../dstar-context-compaction'
import { summarizeWithDstar } from '../dstar-context-archive'

it.skipIf(process.env.DSTAR_SUMMARY_SPLIT_LIVE !== 'true')('recovers truncated merges on a local bounded summary slot', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor)
  vi.stubGlobal('AbortSignal', native.signal.constructor)
  const originalFetch = globalThis.fetch
  const attempts: { offset: number; length: number; finish: string; generated: number; maxOutput: number; inputBound: number }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string), fragment = JSON.parse(body.messages[1].content)
    const response = await originalFetch(url, init)
    const result = await response.clone().json()
    attempts.push({ offset: fragment.evidenceOffset, length: Array.from(fragment.newEvidence).length,
      finish: result.choices?.[0]?.finish_reason, generated: result.usage?.completion_tokens, maxOutput: body.max_tokens,
      inputBound: body.messages.reduce((n: number, m: { content: string }) => n + new TextEncoder().encode(m.content).length, 0) })
    return response
  })
  try {
    const record = JSON.parse(await readFile(process.env.DSTAR_SUMMARY_RECORD!, 'utf8')) as ArchiveRecord
    // Replay only the bounded opening evidence that previously failed, never
    // write private conversation content to the verification report.
    const evidence = Array.from(summaryEvidence(record.source)).slice(0, 4800).join('')
    const result = await summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')('', evidence, new AbortController().signal)
    expect(result.trim()).not.toBe('')
    let committed = 0
    for (const attempt of attempts) {
      expect(attempt.inputBound + attempt.maxOutput + 512).toBeLessThanOrEqual(8192)
      expect(attempt.maxOutput).toBeGreaterThanOrEqual(1680)
      expect(attempt.offset).toBe(committed)
      if (attempt.finish === 'stop') committed += attempt.length
    }
    expect(committed).toBe(Array.from(evidence).length)
    await writeFile(process.env.DSTAR_SUMMARY_RESULT!, JSON.stringify({ completed: true, evidencePoints: committed, summaryBytes: new TextEncoder().encode(result).length, attempts }, null, 2))
  } finally { vi.unstubAllGlobals() }
}, 600000)
