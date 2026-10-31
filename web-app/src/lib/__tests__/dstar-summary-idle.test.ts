import { expect, it, vi } from 'vitest'
import { beginDstarForeground, runIdleSummaryRequest } from '../dstar-summary-idle'
const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
it('waits for every foreground request and normalizes endpoint slashes', async () => {
  const a = beginDstarForeground('http://qa/one/'), b = beginDstarForeground('http://qa/one')
  const run = vi.fn().mockResolvedValue('summary')
  const task = runIdleSummaryRequest('http://qa/one', new AbortController().signal, () => {}, run)
  await settle(); expect(run).not.toHaveBeenCalled()
  a(); a(); await settle(); expect(run).not.toHaveBeenCalled()
  b(); expect(await task).toBe('summary'); expect(run).toHaveBeenCalledTimes(1)
})
it('interrupts and retries an uncommitted fragment after chat without reporting failure', async () => {
  const paused: boolean[] = []
  let attempts = 0
  const run = vi.fn(async (signal: AbortSignal) => {
    if (++attempts === 1) return await new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return 'complete'
  })
  const task = runIdleSummaryRequest('http://qa/two', new AbortController().signal, p => paused.push(p), run)
  await settle()
  const end = beginDstarForeground('http://qa/two')
  await settle(); expect(attempts).toBe(1); expect(paused).toContain(true)
  end(); expect(await task).toBe('complete'); expect(attempts).toBe(2)
})
it('cancels waiters, propagates real errors and leaves other endpoints independent', async () => {
  const end = beginDstarForeground('http://qa/three')
  const abort = new AbortController()
  const task = runIdleSummaryRequest('http://qa/three', abort.signal, () => {}, async () => 'never')
  abort.abort()
  await expect(task).rejects.toBeDefined()
  expect(await runIdleSummaryRequest('http://qa/four', new AbortController().signal, () => {}, async () => 'other')).toBe('other')
  end()
  await expect(runIdleSummaryRequest('http://qa/three', new AbortController().signal, () => {}, async () => { throw new Error('network') })).rejects.toThrow('network')
})
it('waits for client tools and their final answer even if the provider says stop', async () => {
  const { summaryTurnHasToolsPending } = await import('../dstar-summary-idle')
  const message = (parts: unknown[]) => ({ id: 'a', role: 'assistant', parts }) as import('ai').UIMessage
  expect(summaryTurnHasToolsPending(message([{ type: 'tool-search', state: 'approval-requested' }]))).toBe(true)
  expect(summaryTurnHasToolsPending(message([{ type: 'text', text: 'Searching.' }, { type: 'tool-search', state: 'output-available', output: 'found' }]))).toBe(true)
  expect(summaryTurnHasToolsPending(message([{ type: 'tool-search', state: 'output-available', output: 'found' }, { type: 'text', text: 'The final answer.' }]))).toBe(false)
})
