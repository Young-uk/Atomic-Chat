import { transferableAbortController } from 'node:util'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import type { SummaryCheckpoint } from '../dstar-context-compaction'
import { summarizeWithDstar } from '../dstar-context-archive'

it.skipIf(process.env.ATOMIC_DSTAR_CHECKPOINT_LIVE !== 'true')('repacks large memory and resumes a durable fragment with the actual summary slot', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor); vi.stubGlobal('AbortSignal', native.signal.constructor)
  const originalFetch = globalThis.fetch
  const attempts: { repack: boolean; offset?: number; finish?: string; output?: number }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string), input = JSON.parse(body.messages[1].content)
    const response = await originalFetch(url, init), result = await response.clone().json()
    attempts.push({ repack: 'historicalHandoff' in input, offset: input.evidenceOffset,
      finish: result.choices?.[0]?.finish_reason, output: result.usage?.completion_tokens })
    return response
  })
  try {
    const root = '/private/tmp/atomic-summary-checkpoint-live'
    await mkdir(root, { recursive: true })
    const previous = 'Confirmed project MAPLE_CANARY. Preserve original records and recent questions. '.repeat(85)
    const evidence = 'New confirmed decision: retain searchable local archives. '.repeat(100)
    const controller = new AbortController()
    const save = async (checkpoint: SummaryCheckpoint) => {
      await writeFile(root + '/point.pending', JSON.stringify(checkpoint))
      await rename(root + '/point.pending', root + '/point.json')
      if (checkpoint.completed >= 1) controller.abort(new Error('QA restart after durable commit'))
    }
    await expect(summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')(
      previous, evidence, controller.signal, undefined, { save })).rejects.toThrow()
    const resume = JSON.parse(await readFile(root + '/point.json', 'utf8')) as SummaryCheckpoint
    expect(resume.completed).toBeGreaterThanOrEqual(1)
    expect(resume.offset).toBeGreaterThan(0)
    const at = attempts.length
    const final = await summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')(
      previous, evidence, new AbortController().signal, undefined, { resume, save: async c => {
        await writeFile(root + '/point.pending', JSON.stringify(c)); await rename(root + '/point.pending', root + '/point.json')
      } })
    expect(final).toContain('MAPLE_CANARY')
    expect(attempts.some(a => a.repack)).toBe(true)
    expect(attempts.slice(at).find(a => !a.repack)?.offset).toBe(resume.offset)
    const finished = JSON.parse(await readFile(root + '/point.json', 'utf8')) as SummaryCheckpoint
    expect(finished.offset).toBe(Array.from(evidence).length)
    await writeFile(root + '/result.json', JSON.stringify({ completed: true, resumedOffset: resume.offset,
      finalOffset: finished.offset, completedSections: finished.completed, attempts }, null, 2))
  } finally { vi.unstubAllGlobals() }
}, 600000)
