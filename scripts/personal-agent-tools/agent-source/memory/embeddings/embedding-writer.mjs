import { EmbeddingUnavailableError } from "./embedding-client.mjs";
class EmbeddingWriter {
  /**
   * Exposed read-only so `MemoryStore.recallHybridAsync` can reuse the
   * same client (and `model` / `dim`) without a separate dependency
   * injection. The setter exists only here in the constructor.
   */
  client;
  store;
  metrics;
  now;
  constructor(deps) {
    this.client = deps.client;
    this.store = deps.store;
    this.metrics = deps.metrics;
    this.now = deps.now ?? Date.now;
  }
  /**
   * Compute and persist an embedding for `(memoryId, content)`. Returns
   * `true` on success, `false` when the call gracefully degraded.
   * Never throws — see module doc.
   */
  async writeFor(memoryId, content) {
    return await this.write(memoryId, content) === "stored";
  }
  /**
   * `writeFor` that says why a write did not land: `unavailable` is the
   * client's typed transport error (the model is down or the request
   * was aborted), `failed` anything else. The backfill stops on either
   * instead of walking the rest of the corpus into the same error.
   * Never throws.
   */
  async write(memoryId, content, signal) {
    const started = this.now();
    try {
      const result = await this.client.embed({
        text: content,
        purpose: "document",
        ...signal ? { signal } : {}
      });
      this.store.upsert({
        memoryId,
        model: result.model,
        dim: this.client.dim,
        vector: result.vector,
        createdAt: this.now()
      });
      this.metrics?.recordMemoryEmbeddingsGenerated({
        model: result.model,
        durationMs: this.now() - started
      });
      return "stored";
    } catch (err) {
      this.metrics?.recordMemoryEmbeddingsFallback({
        reason: "embed_failed"
      });
      return err instanceof EmbeddingUnavailableError ? "unavailable" : "failed";
    }
  }
}
export {
  EmbeddingWriter
};
