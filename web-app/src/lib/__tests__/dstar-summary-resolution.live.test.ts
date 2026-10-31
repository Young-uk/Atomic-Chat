import { transferableAbortController } from 'node:util'
import { request as httpRequest } from 'node:http'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { summaryEvidence, type ArchiveRecord } from '../dstar-context-compaction'
import { summarizeWithDstar } from '../dstar-context-archive'

it.skipIf(process.env.ATOMIC_DSTAR_RESOLUTION_LIVE !== 'true')('advances the actual failed ledger checkpoint without changing its original archive', async () => {
  const original = await readFile(process.env.DSTAR_RESOLUTION_REPLAY_RECORD!, 'utf8')
  const record = JSON.parse(original) as ArchiveRecord
  const resume = process.env.DSTAR_RESOLUTION_REPLAY_CHECKPOINT
    ? JSON.parse(await readFile(process.env.DSTAR_RESOLUTION_REPLAY_CHECKPOINT, 'utf8')) as NonNullable<ArchiveRecord['checkpoint']>
    : record.checkpoint
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor)
  vi.stubGlobal('AbortSignal', native.signal.constructor)
  vi.stubGlobal('fetch', (url: string, init: RequestInit): Promise<Response> => new Promise((resolve, reject) => {
    const body = init.body as string
    const req = httpRequest(url, { method: init.method, signal: init.signal ?? undefined,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      const chunks: Buffer[] = []
      response.on('data', c => chunks.push(Buffer.from(c)))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: response.statusCode ?? 500 })))
      response.on('error', reject)
    })
    req.on('error', reject); req.end(body)
  }))
  const root = await mkdtemp(tmpdir() + '/atomic-resolution-replay-')
  try {
    let advanced = false
    let finalOffset = resume!.offset
    const complete = process.env.DSTAR_RESOLUTION_REPLAY_COMPLETE === 'true'
    const task = summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')(
      '', summaryEvidence(record.source), new AbortController().signal, undefined, {
        resume, requestSources: record.source,
        save: async point => {
          if (point.offset <= resume!.offset) return
          expect(point.completed).toBeGreaterThan(resume!.completed)
          await writeFile(root + '/checkpoint.json', JSON.stringify(point), { mode: 0o600 })
          advanced = true; finalOffset = point.offset
          if (!complete) throw new Error('Planned pause after verified durable progress')
        },
      })
    if (complete) {
      expect((await task).trim()).not.toBe('')
      expect(finalOffset).toBe(Array.from(summaryEvidence(record.source)).length)
    } else await expect(task).rejects.toThrow('Planned pause after verified durable progress')
    expect(advanced).toBe(true)
    expect(await readFile(process.env.DSTAR_RESOLUTION_REPLAY_RECORD!, 'utf8')).toBe(original)
  } finally { vi.unstubAllGlobals() }
}, 1200000)
