import { transferableAbortController } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { summarizeWithDstar } from '../dstar-context-archive'
import { summaryEvidence } from '../dstar-context-compaction'

it.skipIf(process.env.DSTAR_SUMMARY16_LIVE !== 'true')('compares legacy fragments with token-packed fragments on one installed model', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor)
  vi.stubGlobal('AbortSignal', native.signal.constructor)
  const fetcher = globalThis.fetch
  const results: any[] = []
  const source = Array.from({ length: 60 }, (_, index) => ({ id: `synthetic-${index}`, role: index ? 'assistant' as const : 'user' as const,
    parts: [{ type: 'text' as const, text: `The confirmed project is MAPLE_FIXTURE. The user's preferred report language is Korean. The report is pending, not completed. Observation ${index}: repeated benchmark details are incidental; preserve the project, preference and pending report. ` + 'The sample contains no private data. '.repeat(3) }] }))
  const evidence = summaryEvidence(source)
  try {
    for (const tokenCounting of [false, true]) {
      const calls: any[] = []
      const countedInputs = new Map<string, number>()
      let countCalls = 0
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        const response = await fetcher(url, init)
        const result = await response.clone().json()
        if (url.endsWith('/summary-token-count')) {
          countCalls++
          countedInputs.set(JSON.stringify(body.messages), result.input_tokens)
        } else calls.push({ inputTokens: result.usage?.prompt_tokens, countedTokens: countedInputs.get(JSON.stringify(body.messages)), outputTokens: result.usage?.completion_tokens,
          finish: result.choices?.[0]?.finish_reason, evidenceLength: JSON.parse(body.messages[1].content).newEvidence?.length ?? 0 })
        return response
      })
      const started = performance.now()
      const summary = await summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat', { tokenCounting })('', evidence, new AbortController().signal)
      const result = { tokenCounting, elapsedMs: performance.now() - started, countCalls, calls,
        keepsProject: summary.includes('MAPLE_FIXTURE'), summaryBytes: new TextEncoder().encode(summary).length }
      results.push(result)
      if (process.env.DSTAR_SUMMARY16_RESULT) await writeFile(process.env.DSTAR_SUMMARY16_RESULT, JSON.stringify({ evidenceCharacters: Array.from(evidence).length, results }, null, 2))
      expect(result.keepsProject).toBe(true)
      expect(summary.trim()).not.toBe('')
      expect(calls.every(c => c.finish === 'stop')).toBe(true)
      if (tokenCounting) expect(calls.every(c => c.inputTokens === c.countedTokens && c.inputTokens <= 13_312)).toBe(true)
    }
    expect(results[1].calls.length).toBeLessThan(results[0].calls.length)
  } finally { vi.unstubAllGlobals() }
}, 1_800_000)
