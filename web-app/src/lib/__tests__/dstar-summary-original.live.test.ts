import { transferableAbortController } from 'node:util'
import { request as httpRequest } from 'node:http'
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { summaryEvidence, type ArchiveRecord, type SummaryCheckpoint } from '../dstar-context-compaction'
import { summarizeWithDstar } from '../dstar-context-archive'

it.skipIf(process.env.ATOMIC_DSTAR_ORIGINAL_LIVE !== 'true')('completes the entire locally archived evidence with durable restart progress', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor); vi.stubGlobal('AbortSignal', native.signal.constructor)
  // Node fetch has a separate five-minute headers deadline for nonstreaming
  // responses. Match the production request's ten-minute abort budget instead.
  vi.stubGlobal('fetch', (url: string, init: RequestInit): Promise<Response> => new Promise((resolve, reject) => {
    const body = init.body as string
    const req = httpRequest(url, { method: init.method, signal: init.signal ?? undefined,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode ?? 500 })))
    })
    req.on('error', reject)
    req.setTimeout(600000, () => req.destroy(new Error('Local summary validation request timed out')))
    req.end(body)
  }))
  const root = '/private/tmp/atomic-summary-original-checkpoint'
  await mkdir(root, { recursive: true })
  const record = JSON.parse(await readFile(process.env.ATOMIC_DSTAR_ORIGINAL_RECORD!, 'utf8')) as ArchiveRecord
  const evidence = summaryEvidence(record.source)
  let resume: SummaryCheckpoint | undefined
  try { resume = JSON.parse(await readFile(root + '/point.json', 'utf8')) as SummaryCheckpoint } catch { /* First run has no durable progress. */ }
  try {
    const final = await summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')(
      record.previousSummary, evidence, new AbortController().signal, undefined, { resume, save: async checkpoint => {
        await writeFile(root + '/point.pending', JSON.stringify(checkpoint))
        await rename(root + '/point.pending', root + '/point.json')
        try { await access(root + '/pause') } catch { return }
        throw new Error('QA paused after durable commit')
      } })
    const point = JSON.parse(await readFile(root + '/point.json', 'utf8')) as SummaryCheckpoint
    expect(point.offset).toBe(Array.from(evidence).length)
    expect(final.trim()).not.toBe('')
    await writeFile(root + '/result.json', JSON.stringify({ completed: true, resumedAt: resume?.offset ?? 0, sourceMessages: record.source.length,
      evidencePoints: Array.from(evidence).length, completedSections: point.completed,
      summaryBytes: new TextEncoder().encode(final).length }, null, 2))
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'QA paused after durable commit') throw error
    const point = JSON.parse(await readFile(root + '/point.json', 'utf8')) as SummaryCheckpoint
    expect(point.offset).toBeGreaterThan(0)
    await writeFile(root + '/paused.json', JSON.stringify({ plannedPause: true, offset: point.offset, completed: point.completed }))
  } finally { vi.unstubAllGlobals() }
}, 3600000)
