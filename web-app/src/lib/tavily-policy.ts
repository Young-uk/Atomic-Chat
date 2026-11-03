/** Shared across Tavily tools so changing endpoints cannot bypass a cooldown. */
export class TavilyPolicy {
  private blockedUntil = 0
  private pending = new Set<string>()

  async call<T>(name: string, input: object, dispatch: (input: object) => Promise<T>): Promise<T> {
    if (!name.startsWith('tavily_')) return dispatch(input)
    if (Date.now() < this.blockedUntil) {
      throw new Error(`Tavily rate limited. Retry in ${Math.ceil((this.blockedUntil - Date.now()) / 1000)} seconds, or use another available search provider. Do not substitute Tavily research.`)
    }
    const args = { ...input } as Record<string, unknown>
    if (name === 'tavily_search') {
      args.search_depth ??= 'fast'
      args.max_results ??= 5
    }
    const key = JSON.stringify([name, Object.keys(args).sort().map(key => [key, args[key]])])
    // Reject instead of sharing cancellable work owned by another conversation.
    if (this.pending.has(key)) throw new Error('An identical Tavily request is already running. Wait for its result; do not repeat it.')
    this.pending.add(key)
    const observe = (value: unknown) => {
      let limited = typeof value === 'string' && /(?:HTTP|status|error)[ :"=]*429\b/i.test(value)
      let seconds = 60
      const visit = (item: unknown) => {
        if (typeof item === 'string') { try { visit(JSON.parse(item)) } catch { /* Plain text is not metadata. */ } }
        else if (item && typeof item === 'object') {
          for (const [key, value] of Object.entries(item)) {
            if (key.toLowerCase() === 'retry-after') {
              const delay = Number(value)
              const date = typeof value === 'string' ? Date.parse(value) : NaN
              if (Number.isFinite(delay) && delay >= 0) seconds = delay
              else if (Number.isFinite(date)) seconds = Math.max(0, (date - Date.now()) / 1000)
            }
            if ((key === 'status' || key === 'statusCode') && Number(value) === 429) limited = true
            visit(value)
          }
        }
      }
      visit(value)
      // Remote MCP may omit HTTP headers; 60 seconds is only the fallback.
      if (limited) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + seconds * 1000)
    }
    try {
      const result = await dispatch(args)
      observe(result)
      return result
    } catch (error) {
      observe(String(error))
      throw error
    } finally { this.pending.delete(key) }
  }
}
