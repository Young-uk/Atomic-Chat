import type { UIMessage } from 'ai'

/** Rust's durable JSON maps reorder object keys. Canonicalize only the model
 * copy so live continuation and disk replay encode identical tool history.
 * Arrays, strings, tool execution arguments and stored evidence stay intact. */
export function stableModelToolJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableModelToolJson)
  if (value && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, stableModelToolJson(child)]))
  }
  return value
}

export function stableModelToolMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(message => ({ ...message, parts: message.parts.map(part => {
    if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return part
    const next = { ...part } as Record<string, unknown>
    for (const field of ['input', 'args', 'output', 'result']) {
      if (field in next) next[field] = stableModelToolJson(next[field])
    }
    return next as typeof part
  }) }))
}
