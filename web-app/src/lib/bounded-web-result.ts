/** Bound only the model projection. The persisted tool result remains complete.
 * A crawl is a discovery batch, not permission to fill the entire chat window
 * with every page. Keep URLs/metadata and explicit excerpts for follow-up reads. */
export function boundedWebResult(name: string, output: unknown): unknown {
  if (!/^tavily[-_](crawl|extract)$/.test(name) || !Array.isArray(output)) return output
  const serialized = JSON.stringify(output)
  if (serialized.length <= 24000) return output
  let remaining = 16000
  const excerpt = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
      // URLs remain actionable even when the text excerpt budget is consumed.
      const limit = key === 'url' ? 2000 : Math.min(4000, Math.max(0, remaining))
      const text = value.slice(0, limit)
      if (key !== 'url') remaining -= text.length
      return text.length < value.length ? `${text}\n[Excerpt: ${value.length - text.length} characters omitted]` : value
    }
    if (Array.isArray(value)) return value.slice(0, 30).map(item => excerpt(item))
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).slice(0, 40).map(([k, v]) => [k, excerpt(v, k)]))
    return value
  }
  const blocks = output.slice(0, 10).map(block => {
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return block
    let value: unknown
    try { value = JSON.parse(block.text) } catch { value = block.text }
    return { ...block, text: JSON.stringify(excerpt(value)) }
  })
  const bounded = JSON.stringify(blocks).length <= 22000 ? blocks : [{ type: 'text', text: `${JSON.stringify(blocks).slice(0, 21000)}\n[Result excerpt ended; additional metadata omitted]` }]
  return [{ type: 'text', text: 'Large web result: excerpts only. The full original result is retained in conversation storage. Do not infer omitted content. Use a targeted extract/read of a listed URL for missing details.' }, ...bounded]
}
