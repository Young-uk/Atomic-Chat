import { expect, it, vi } from 'vitest'
import { beginDstarForeground, runIdleSummaryRequest } from '../dstar-summary-idle'
const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
it('starts a summary even while foreground requests are active', async () => {
  const a = beginDstarForeground('http://qa/one/'), b = beginDstarForeground('http://qa/one')
  const run = vi.fn().mockResolvedValue('summary')
  try {
    expect(await runIdleSummaryRequest('http://qa/one', new AbortController().signal, () => {}, run)).toBe('summary')
    expect(run).toHaveBeenCalledTimes(1)
  } finally { a(); a(); b() }
})
it('preserves the same in-flight fragment across multiple foreground turns', async () => {
  const paused: boolean[] = [], owner = new AbortController()
  let finish!: (value: string) => void
  const run = vi.fn((signal: AbortSignal) => {
    expect(signal).toBe(owner.signal)
    return new Promise<string>(resolve => { finish = resolve })
  })
  const task = runIdleSummaryRequest('http://qa/two', owner.signal, p => paused.push(p), run)
  const first = beginDstarForeground('http://qa/two')
  await settle(); first()
  const second = beginDstarForeground('http://qa/two')
  await settle()
  expect(owner.signal.aborted).toBe(false)
  expect(run).toHaveBeenCalledTimes(1)
  expect(paused).toEqual([false])
  finish('complete')
  try { expect(await task).toBe('complete') } finally { second() }
})
it('preserves owner cancellation and propagates actual request failures', async () => {
  const owner = new AbortController()
  const task = runIdleSummaryRequest('http://qa/three', owner.signal, () => {}, signal =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  owner.abort(new Error('edited history'))
  await expect(task).rejects.toThrow('edited history')
  const run = vi.fn()
  await expect(runIdleSummaryRequest('http://qa/three', owner.signal, () => {}, run)).rejects.toThrow('edited history')
  expect(run).not.toHaveBeenCalled()
  await expect(runIdleSummaryRequest('http://qa/four', new AbortController().signal, () => {}, async () => { throw new Error('network') })).rejects.toThrow('network')
})
it('waits for client tools and their final answer even if the provider says stop', async () => {
  const { summaryTurnHasToolsPending } = await import('../dstar-summary-idle')
  const message = (parts: unknown[]) => ({ id: 'a', role: 'assistant', parts }) as import('ai').UIMessage
  expect(summaryTurnHasToolsPending(message([{ type: 'tool-search', state: 'approval-requested' }]))).toBe(true)
  expect(summaryTurnHasToolsPending(message([{ type: 'text', text: 'Searching.' }, { type: 'tool-search', state: 'output-available', output: 'found' }]))).toBe(true)
  expect(summaryTurnHasToolsPending(message([{ type: 'tool-search', state: 'output-available', output: 'found' }, { type: 'text', text: 'The final answer.' }]))).toBe(false)
})
