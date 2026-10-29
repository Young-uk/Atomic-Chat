/** New search results contain both a rendered summary and the same structured
 * snippets. Remove the summary only when it is an exact rendering of results.
 * Keep all structured fields, errors and unfamiliar provider formats unchanged.
 * Apply at ingest, never rewrite old tool messages and invalidate cached history. */
export function compactSearchOutput(name: string, content: unknown): unknown {
  if (name !== 'web_search_exa' || !Array.isArray(content)) return content
  return content.map((block) => {
    if (!block || typeof block.text !== 'string') return block
    try {
      const value = JSON.parse(block.text)
      const results = value.details?.results
      if (value.status !== 'ok' || !Array.isArray(results) || !results.length ||
          !results.every((r) => typeof r.title === 'string' && typeof r.url === 'string' && typeof r.snippet === 'string')) return block
      const rendered = results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`).join('\n\n')
      if (rendered !== value.summary) return block
      const unique = { ...value }
      delete unique.summary
      return { ...block, text: JSON.stringify(unique) }
    } catch { return block }
  })
}
