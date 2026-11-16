import type { UIMessage } from 'ai'

type Evidence = { id: string; role: 'user' | 'assistant' | 'tool'; text: string; verified?: boolean }
/** Only user-visible dialogue and observed tool results; never reasoning or announcements. */
function successfulOutput(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') {
    if (/^\s*(?:error\b|failed\b|exception\b)/i.test(value)) return false
    try { return successfulOutput(JSON.parse(value)) } catch { return true }
  }
  if (Array.isArray(value)) return value.length > 0 && value.every(part => successfulOutput(part))
  if (typeof value !== 'object') return true
  const row = value as Record<string, unknown>
  if (row.type === 'text') return successfulOutput(row.text)
  if (row.isError === true || row.success === false || row.error || ['error', 'failed', 'failure'].includes(String(row.status))) return false
  if (['exitCode', 'exit_code'].some(key => typeof row[key] === 'number' && row[key] !== 0)) return false
  if (Array.isArray(row.content) && row.content.some(part => part && typeof part === 'object' && 'text' in part && !successfulOutput(part.text))) return false
  return true
}
/** Strip binary blocks before serializing observed tool evidence. */
function textToolOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter(part => !(part && typeof part === 'object' && ['image', 'audio'].includes(String(part.type)))).map(textToolOutput)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['image', 'image_url', 'audio', 'base64'].includes(key)).map(([key, item]) => [key, textToolOutput(item)]))
}
export function captureBackgroundReviewEvidence(messages: UIMessage[]): Evidence[] {
  const candidates: (Evidence & { order: number })[] = []
  const seen = new Set<string>()
  const window = messages.slice(-8)
  for (let index = window.length - 1; index >= 0; index--) {
    const message = window[index]
    const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 2000)
    if (text && ['user', 'assistant'].includes(message.role) && !seen.has(message.id)) { seen.add(message.id); candidates.push({ id: message.id, role: message.role as 'user' | 'assistant', text, order: index * 1000 }) }
    for (const [partIndex, part] of message.parts.entries()) {
      if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-')) || !('state' in part) || part.state !== 'output-available') continue
      const tool = part as unknown as { toolCallId: string; input?: unknown; output?: unknown; toolName?: string }
      const id = `tool:${tool.toolCallId}`
      if (!tool.toolCallId || seen.has(id) || !successfulOutput(tool.output)) continue
      const body = JSON.stringify({ tool: tool.toolName ?? part.type, input: textToolOutput(tool.input), output: textToolOutput(tool.output) })
      if (body) { seen.add(id); candidates.push({ id, role: 'tool', text: body.slice(0, 2000), verified: true, order: index * 1000 + partIndex + 1 }) }
    }
  }
  // Keep user evidence before tool-heavy assistant turns consume the budget.
  const priority = (row: Evidence) => row.role === 'user' ? 0 : row.role === 'tool' ? 1 : 2
  candidates.sort((a, b) => priority(a) - priority(b) || b.order - a.order)
  let budget = 12000
  const selected = candidates.filter(row => { if (row.text.length > budget) return false; budget -= row.text.length; return true }).slice(0, 24)
  return selected.sort((a, b) => a.order - b.order).map(row => ({ id: row.id, role: row.role, text: row.text, ...(row.verified ? { verified: true } : {}) }))
}
