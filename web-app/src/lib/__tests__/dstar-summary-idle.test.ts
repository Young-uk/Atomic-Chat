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

it('waits for an idle endpoint only for disk-preserved background fallback', async () => {
  const endpoint = 'http://qa/cold-idle', end = beginDstarForeground(endpoint)
  const run = vi.fn().mockResolvedValue('done'), paused = vi.fn()
  const task = runIdleSummaryRequest(endpoint,new AbortController().signal,paused,run,{idleOnly:true})
  await settle()
  expect(run).not.toHaveBeenCalled()
  expect(paused).toHaveBeenCalledWith(true)
  end()
  expect(await task).toBe('done')
  expect(run).toHaveBeenCalledTimes(1)
})
it('cancels an idle wait without sending inference or leaking its next notification', async () => {
  const endpoint = 'http://qa/cancel-idle', end = beginDstarForeground(endpoint)
  const owner = new AbortController(), run = vi.fn()
  const task = runIdleSummaryRequest(endpoint,owner.signal,()=>{},run,{idleOnly:true})
  owner.abort(new Error('history edited'))
  await expect(task).rejects.toThrow('history edited')
  end(); await settle()
  expect(run).not.toHaveBeenCalled()
})

it('also waits for native foreground activity outside this UI and cleans its timer', async () => {
  vi.useFakeTimers()
  try {
    let busy=true
    const run=vi.fn().mockResolvedValue('idle')
    const task=runIdleSummaryRequest('http://qa/server-idle',new AbortController().signal,()=>{},run,{idleOnly:true,serverIdle:async()=>!busy})
    await settle();expect(run).not.toHaveBeenCalled()
    busy=false;await vi.advanceTimersByTimeAsync(500)
    expect(await task).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  } finally {vi.useRealTimers()}
})
