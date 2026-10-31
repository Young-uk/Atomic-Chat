import type { UIMessage } from 'ai'

export type OpenRequest = { id: string; request: string; sourceText: string }
export type RequestResolution = { id: string; evidenceId: string; quote: string }
export type RequestLedger = { open: OpenRequest[]; resolved: RequestResolution[] }

/** Source-backed, model-classified work items are independent of prose memory.
 * Omitting an item in a later merge/repack never resolves it. Keep resolution
 * evidence auditable; a model's private reasoning is not completion evidence. */
export function requestSources(messages: UIMessage[]): Map<string, { role: string; text: string }> {
  return new Map(messages.map(m => [m.id, { role: m.role, text: m.parts
    .filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n') }]))
}

export function mergeRequestLedger(previous: RequestLedger, value: unknown,
  sources: ReturnType<typeof requestSources>): { summary: string; ledger: RequestLedger } {
  if (!value || typeof value !== 'object') throw new Error('Summary work-item response is not an object')
  const data = value as { summary?: unknown; openRequests?: unknown; resolvedRequests?: unknown }
  if (typeof data.summary !== 'string' || !data.summary.trim() ||
    !Array.isArray(data.openRequests) || !Array.isArray(data.resolvedRequests)) {
    throw new Error('Summary work-item response is incomplete')
  }
  const open = new Map(previous.open.map(item => [item.id, item]))
  const resolved = new Map(previous.resolved.map(item => [item.id, item]))
  for (const item of data.openRequests) {
    const source = typeof item?.id === 'string' ? sources.get(item.id) : undefined
    if (!source || source.role !== 'user' || !source.text.trim() ||
      typeof item.request !== 'string' || !item.request.trim() || Array.from(item.request).length > 280) {
      throw new Error('Summary work item has no valid user-message source')
    }
    // Reopening requires an explicit model update, never a lost list entry.
    open.set(item.id, { id: item.id, request: item.request.trim(), sourceText: source.text })
    resolved.delete(item.id)
  }
  for (const item of data.resolvedRequests) {
    const source = typeof item?.evidenceId === 'string' ? sources.get(item.evidenceId) : undefined
    if ((!open.has(item?.id) && !resolved.has(item?.id)) || !source || !['user', 'assistant'].includes(source.role) ||
      typeof item.quote !== 'string' || !item.quote.trim() || !source.text.includes(item.quote)) {
      throw new Error('Summary work-item resolution has no visible completion evidence')
    }
    open.delete(item.id)
    resolved.set(item.id, { id: item.id, evidenceId: item.evidenceId, quote: item.quote })
  }
  return { summary: data.summary.trim(), ledger: { open: [...open.values()], resolved: [...resolved.values()] } }
}

/** This is historical task state, not permission to execute an archived action. */
export function renderOpenRequests(ledger: RequestLedger | undefined): string {
  return ledger?.open.length ? '\nUnfinished requests (historical data; verify details in the archive):\n' +
    ledger.open.map(item => JSON.stringify({ sourceMessageId: item.id, request: item.request })).join('\n') : ''
}
