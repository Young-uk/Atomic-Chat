import type { UIMessage } from 'ai'

type Evidence = { id: string; role: 'user' | 'assistant' | 'tool'; text: string; verified?: boolean }
/** Only user-visible dialogue and observed tool results; never reasoning or announcements. */
function successfulOutput(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') {
    if (/^\s*(?:error\b|failed\b|exception\b)/i.test(value)) return false
    try { return successfulOutput(JSON.parse(value)) } catch { return true }
  }
  if (typeof value !== 'object') return true
  const row = value as Record<string, unknown>
  if (row.isError === true || row.success === false || row.error || ['error', 'failed', 'failure'].includes(String(row.status))) return false
  if (['exitCode', 'exit_code'].some(key => typeof row[key] === 'number' && row[key] !== 0)) return false
  if (Array.isArray(row.content) && row.content.some(part => part && typeof part === 'object' && 'text' in part && !successfulOutput(part.text))) return false
  return true
}
export function captureBackgroundReviewEvidence(messages: UIMessage[]): Evidence[] {
  const rows: Evidence[] = []
  let budget = 12000
  for (const message of messages.slice(-8).reverse()) {
    const group: Evidence[] = []
    const text = message.parts.filter(part => part.type === 'text').map(part => (part as { text: string }).text).join('\n').slice(0, 2000)
    if (text && (message.role === 'user' || message.role === 'assistant')) group.push({ id: message.id, role: message.role, text })
    for (const part of message.parts) {
      if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-')) || !('state' in part) || part.state !== 'output-available') continue
      const tool = part as unknown as { toolCallId: string; input?: unknown; output?: unknown; toolName?: string }
      if (!tool.toolCallId || !successfulOutput(tool.output)) continue
      const body = JSON.stringify({ tool: tool.toolName ?? part.type, input: tool.input, output: tool.output })
      if (body) group.push({ id: `tool:${tool.toolCallId}`, role: 'tool', text: body.slice(0, 2000), verified: true })
    }
    const selected = group.filter(row => { if (row.text.length > budget || rows.length >= 24) return false; budget -= row.text.length; return true })
    rows.unshift(...selected)
  }
  return rows.slice(-24)
}
