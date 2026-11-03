import { afterEach, expect, it, vi } from 'vitest'
import { TavilyPolicy } from './tavily-policy'
afterEach(() => vi.useRealTimers())
it('defaults search without overriding deliberate escalation or other providers', async () => {
 const policy = new TavilyPolicy()
 const send = vi.fn(async input => input)
 expect(await policy.call('tavily_search', { query: 'test' }, send)).toEqual({ query: 'test', search_depth: 'fast', max_results: 5 })
 expect(await policy.call('tavily_search', { search_depth: 'advanced', max_results: 3 }, send)).toEqual({ search_depth: 'advanced', max_results: 3 })
 expect(await policy.call('other_search', {}, send)).toEqual({})
})
it('blocks all Tavily endpoints until Retry-After expires without dispatching', async () => {
 vi.useFakeTimers()
 const policy = new TavilyPolicy()
 const send = vi.fn(async () => ({ content: [{ text: JSON.stringify({ status: 429, headers: { 'Retry-After': '32' } }) }] }))
 await policy.call('tavily_search', {}, send)
 await expect(policy.call('tavily_extract', {}, send)).rejects.toThrow('32 seconds')
 expect(send).toHaveBeenCalledTimes(1)
 vi.advanceTimersByTime(32000)
 await policy.call('tavily_extract', {}, send)
 expect(send).toHaveBeenCalledTimes(2)
})
it('rejects duplicate in-flight work and releases it after completion', async () => {
 const policy = new TavilyPolicy()
 let finish!: (value: object) => void
 const send = vi.fn(() => new Promise<object>(resolve => { finish = resolve }))
 const first = policy.call('tavily_search', { query: 'test' }, send)
 await expect(policy.call('tavily_search', { query: 'test' }, send)).rejects.toThrow('already running')
 finish({})
 await first
 await policy.call('tavily_search', { query: 'test' }, async () => ({}))
 expect(send).toHaveBeenCalledTimes(1)
})
it('does not rate-limit ordinary result text and uses a bounded fallback for missing headers', async () => {
 vi.useFakeTimers()
 const policy = new TavilyPolicy()
 await policy.call('tavily_search', {}, async () => ({ content: [{ text: 'An article about HTTP 429 errors' }] }))
 await policy.call('tavily_search', {}, async () => ({ content: [{ text: '{"status":429}' }] }))
 await expect(policy.call('tavily_research', {}, async () => ({}))).rejects.toThrow('60 seconds')
 vi.advanceTimersByTime(60000)
 await policy.call('tavily_search', {}, async () => ({}))
})
