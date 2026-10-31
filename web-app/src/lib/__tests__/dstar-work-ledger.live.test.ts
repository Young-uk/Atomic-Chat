import { transferableAbortController } from 'node:util'
import { expect, it, vi } from 'vitest'
import { summarizeWithDstar } from '../dstar-context-archive'
import { summaryEvidence, type SummaryCheckpoint } from '../dstar-context-compaction'

it.skipIf(process.env.ATOMIC_DSTAR_WORK_LEDGER_LIVE !== 'true')('keeps an announced but unexecuted request open with the real model', async () => {
  const native = transferableAbortController()
  vi.stubGlobal('AbortController', native.constructor); vi.stubGlobal('AbortSignal', native.signal.constructor)
  const source = [
    { id: 'qa-ask-maple', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Please look up MAPLE_CANARY restaurant and tell me its address.' }] },
    { id: 'qa-promise-maple', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'I will check the restaurant address now.' }] },
  ]
  let saved: SummaryCheckpoint | undefined
  try {
    const summary = await summarizeWithDstar('http://127.0.0.1:8010/v1', 'qwen3.8-flash-next-chat')('', summaryEvidence(source), new AbortController().signal, undefined,
      { requestSources: source, save: async checkpoint => { saved = checkpoint } })
    expect(summary.trim()).not.toBe('')
    expect(saved?.requests?.open.some(item => item.id === 'qa-ask-maple')).toBe(true)
    expect(saved?.requests?.resolved).toEqual([])
    expect(saved?.requests?.open[0].sourceText).toBe(source[0].parts[0].text)
  } finally { vi.unstubAllGlobals() }
}, 600000)
