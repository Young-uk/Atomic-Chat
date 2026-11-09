import { expect, it } from 'vitest'
import { readSummaryChoice } from '../summary-stream'
import type { SummaryInputProgress } from '../context-summary-progress'
import { useInferenceProgress } from '../inference-progress'
const stream = (text: string) => new Response(new ReadableStream<Uint8Array>({ start(controller) {
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
  controller.close()
} }), { headers: { 'content-type': 'text/event-stream' } })
const completed = 'data: {"choices":[{"delta":{"content":"요약 결과"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
it.each([
  ': atomic-progress {"processed":50,"total":100,"cache":20}\n\n',
  'data: {"prompt_progress":{"processed":70,"total":120,"cache":20},"choices":[{"delta":{}}]}\n\n',
])('uses the owning response counts across arbitrary UTF-8 chunks: %s', async prefix => {
  const observed: SummaryInputProgress[] = []
  const before = useInferenceProgress.getState()
  const choice = await readSummaryChoice(stream(prefix + completed), new AbortController().signal, p => { if (p) observed.push(p) })
  expect(observed).toContainEqual({ phase: 'reading', processed: 50, total: 100, cache: 20 })
  expect(observed.at(-1)).toEqual({ phase: 'generating', processed: 100, total: 100, cache: 20 })
  expect(choice).toEqual({ message: { role: 'assistant', content: '요약 결과' }, finish_reason: 'stop' })
  expect(useInferenceProgress.getState()).toBe(before)
})
it('does not convert truncated output or a mid-stream refusal into a successful summary', async () => {
  await expect(readSummaryChoice(stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), new AbortController().signal)).rejects.toThrow('before completion')
  await expect(readSummaryChoice(stream('data: {"error":{"code":"atomic_summary_admission_refused"}}\n\ndata: [DONE]\n\n'), new AbortController().signal)).rejects.toThrow('server safety admission')
})
it('ignores invalid progress and honours owner cancellation', async () => {
  const observed: SummaryInputProgress[] = []
  await readSummaryChoice(stream(': atomic-progress {"processed":-1,"total":100,"cache":0}\n\n' + completed), new AbortController().signal, p => { if (p) observed.push(p) })
  expect(observed.some(p => p.phase === 'reading')).toBe(false)
  const owner = new AbortController()
  await expect(readSummaryChoice(stream(': atomic-progress {"processed":1,"total":100,"cache":0}\n\n' + completed), owner.signal,
    () => owner.abort())).rejects.toMatchObject({ name: 'AbortError' })
})

it('keeps summary generation stable when delayed input heartbeats follow output', async () => {
  const observed: SummaryInputProgress[] = []
  const before = useInferenceProgress.getState()
  const text = ': atomic-progress {"processed":100,"total":100,"cache":20}\n\n' +
    'data: {"choices":[{"delta":{"content":"summary"}}]}\n\n' +
    ': atomic-progress {"processed":100,"total":100,"cache":20}\n\n' +
    'data: {"prompt_progress":{"processed":120,"total":120,"cache":20},"choices":[{"delta":{}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  await readSummaryChoice(stream(text), new AbortController().signal, p => { if (p) observed.push(p) })
  const decoding = observed.findIndex(p => p.phase === 'generating')
  expect(decoding).toBeGreaterThanOrEqual(0)
  expect(observed.slice(decoding).every(p => p.phase === 'generating')).toBe(true)
  expect(useInferenceProgress.getState()).toBe(before)
})
