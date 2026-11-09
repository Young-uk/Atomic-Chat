import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

// Only the two managed runtimes may receive unattended local inference.
export function validateTarget(target) {
  const url = new URL(target.endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !['8010', '18080'].includes(url.port) || url.pathname !== '/v1' || url.search || url.hash || url.username || url.password || typeof target.model !== 'string' || !target.model.trim()) throw new Error('Invalid managed inference target')
  return { endpoint: url.href.replace(/\/$/, ''), model: target.model }
}

export async function threadTarget(workspace, threadId) {
  if (!workspace || !threadId) return null
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)) throw new Error('Invalid originating thread')
  const directory = join(dirname(workspace), 'threads', threadId)
  const thread = JSON.parse(await readFile(join(directory, 'thread.json'), 'utf8'))
  const model = thread.model?.id
  const lines = (await readFile(join(directory, 'messages.jsonl'), 'utf8')).trim().split('\n')
  // Scope is written by Chat from the actual provider, never from model text.
  for (const line of lines.reverse()) {
    const row = JSON.parse(line)
    const scope = row.metadata?.contextUsageScope
    if (!scope) continue
    const [provider, endpoint, id] = JSON.parse(scope)
    if (id === model && provider === thread.model?.provider) return validateTarget({ endpoint, model })
  }
  throw new Error('Originating conversation has no verified local inference target; send a normal reply before scheduling')
}

export async function resolveTarget({ target, endpoint, model, signal, fetcher = fetch }) {
  const candidates = target ? [validateTarget(target)] : !['8010', '18080'].includes(new URL(endpoint).port) ? [{ endpoint, model }] : [
    { endpoint, model },
    { endpoint: 'http://127.0.0.1:8010/v1' },
    { endpoint: 'http://127.0.0.1:18080/v1' }
  ].filter((item, index, all) => all.findIndex(other => other.endpoint === item.endpoint) === index)
  const available = []
  await Promise.all(candidates.map(async candidate => {
    try {
      const response = await fetcher(`${candidate.endpoint}/models`, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(1500)]) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const catalog = await response.json()
      if (!catalog.atomic_summary_slot) throw new Error('Background inference slot unavailable')
      const models = catalog.data ?? []
      const selected = target ? models.find(item => item.id === target.model) : models.find(item => item.id === candidate.model) ?? (models.length === 1 ? models[0] : null)
      if (!selected) throw new Error('Selected model is unavailable')
      available.push({ endpoint: candidate.endpoint, model: selected.id })
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if (target) throw new Error(`Scheduled model unavailable at ${candidate.endpoint}: ${error.cause?.code ?? error.message}`)
    }
  }))
  if (available.length !== 1) throw new Error(available.length ? 'Multiple local runtimes are available; an originating conversation target is required' : 'No local runtime with background inference support is available')
  return available[0]
}
