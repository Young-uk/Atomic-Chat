import { describe, expect, it } from 'vitest'
import { boundedWebResult } from './bounded-web-result'

describe('bounded web result projection', () => {
  it('preserves raw crawl evidence and returns bounded explicit excerpts with URLs', () => {
    const raw = [{ type: 'text', text: JSON.stringify({ results: Array.from({ length: 5 }, (_, i) => ({ url: `https://example.com/${i}`, raw_content: 'evidence '.repeat(5000) })) }) }]
    const original = structuredClone(raw)
    const projected = boundedWebResult('tavily_crawl', raw)
    expect(JSON.stringify(projected).length).toBeLessThan(24000)
    expect(JSON.stringify(projected)).toContain('https://example.com/4')
    expect(JSON.stringify(projected)).toContain('omitted')
    expect(raw).toEqual(original)
    expect(boundedWebResult('tavily_crawl', projected)).toBe(projected)
  })
  it('leaves small results and unrelated tools unchanged', () => {
    const small = [{ type: 'text', text: 'small' }]
    expect(boundedWebResult('tavily_extract', small)).toBe(small)
    expect(boundedWebResult('other', small)).toBe(small)
  })
})

it('bounds existing persisted tool parts through the same model image projection', async () => {
  const { prepareToolResultImagesForModel } = await import('./toolResultImages')
  const raw = [{ id: 'active', role: 'assistant' as const, parts: [{ type: 'tool-tavily_crawl', toolCallId: 'crawl', state: 'output-available', input: { url: 'https://example.com' }, output: [{ type: 'text', text: JSON.stringify({ results: [{ url: 'https://example.com', raw_content: 'page text '.repeat(24000) }] }) }] }] }]
  const projected = prepareToolResultImagesForModel(raw as never, { supportsVision: true })
  expect(JSON.stringify(projected).length).toBeLessThan(24000)
  expect(JSON.stringify(raw).length).toBeGreaterThan(200000)
  expect(projected[0].id).toBe('active')
  expect(JSON.stringify(projected)).toContain('crawl')
})
