import { EmbeddingStore } from './agent-source/memory/embeddings/embedding-store.mjs'
import { EmbeddingWriter } from './agent-source/memory/embeddings/embedding-writer.mjs'
import { EmbeddingUnavailableError } from './agent-source/memory/embeddings/embedding-client.mjs'

/** An explicitly configured local model only. There is no model download,
 * cloud fallback, or automatic transmission while the feature is disabled. */
export function semanticMemory(store, config, fetcher = fetch) {
  store.detachEmbeddings()
  if (!config.enabled) return { enabled: false }
  const url = new URL(config.url)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash)
    throw new Error('Memory embeddings require a configured loopback endpoint')
  if (!Number.isSafeInteger(config.dimensions) || config.dimensions < 1 || config.dimensions > 8192 || typeof config.model !== 'string' || !config.model.trim()) throw new Error('Embedding model and dimensions are required')
  const client = { dim: config.dimensions, model: config.model,
    async embed({ text, signal }) {
      try {
        const response = await fetcher(`${url.href.replace(/\/$/, '')}/embeddings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]),
          body: JSON.stringify({ model: config.model, input: text }),
        })
        if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`)
        const body = await response.json(), vector = body.data?.[0]?.embedding
        if (!Array.isArray(vector) || vector.length !== config.dimensions || vector.some(x => typeof x !== 'number' || !Number.isFinite(x)) || (body.model && body.model !== config.model)) throw new Error('Embedding model or vector does not match configuration')
        return { model: config.model, vector: Float32Array.from(vector) }
      } catch (error) { throw new EmbeddingUnavailableError('Configured embedding model unavailable', error) }
    } }
  const vectors = new EmbeddingStore({ db: store.getDatabaseHandleForEmbeddings() })
  const writer = new EmbeddingWriter({ client, store: vectors })
  // Preserve the source hybrid-recall defaults, similarity gates and limits.
  store.attachEmbeddings({ writer, store: vectors })
  return { enabled: true, model: config.model, dimensions: config.dimensions }
}
