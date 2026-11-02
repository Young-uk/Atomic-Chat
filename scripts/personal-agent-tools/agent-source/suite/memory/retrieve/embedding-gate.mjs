import { EmbeddingUnavailableError } from "../embeddings/embedding-client.mjs";
import { cosineSimilarity } from "../embeddings/hybrid-recall.mjs";
function createEmbeddingGate(opts) {
  const threshold = opts.threshold;
  const warmTimeoutMs = opts.warmTimeoutMs ?? 8e3;
  const exemplars = opts.exemplars.filter((e) => e.trim().length > 0);
  let warmVectors = null;
  let warmPromise = null;
  return {
    name: "embedding",
    async check({ message, historyTurnCount, signal }) {
      if (historyTurnCount <= 0) {
        recordSkip(opts, "no_history");
        return false;
      }
      const trimmed = message.trim();
      if (trimmed.length === 0) {
        recordSkip(opts, "empty_message");
        return false;
      }
      if (signal.aborted) {
        return false;
      }
      const vectors = await ensureWarm(opts, warmTimeoutMs, signal);
      if (!vectors || vectors.length === 0) {
        opts.logger?.warn?.("embedding_gate.unavailable", { phase: "warm" });
        recordSkip(opts, "unavailable");
        return false;
      }
      try {
        const { vector } = await opts.embedder.embed({
          text: trimmed,
          signal,
          purpose: "similarity"
        });
        const unit = unitVector(vector);
        let maxScore = -1;
        for (const ref of vectors) {
          const score = cosineSimilarity(unit, ref);
          if (score > maxScore) maxScore = score;
        }
        opts.metrics?.recordRetrieveRewriterGateCosine?.({
          gateMode: "embedding",
          score: maxScore
        });
        if (maxScore >= threshold) {
          opts.logger?.debug?.("embedding_gate.fired", {
            score: maxScore,
            threshold
          });
          opts.metrics?.recordRetrieveRewriterGateFired?.({
            gateMode: "embedding"
          });
          return true;
        }
        opts.logger?.debug?.("embedding_gate.below_threshold", {
          score: maxScore,
          threshold
        });
        recordSkip(opts, "below_threshold");
        return false;
      } catch (err) {
        if (signal.aborted) return false;
        const msg = err instanceof EmbeddingUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
        opts.logger?.warn?.("embedding_gate.unavailable", {
          phase: "embed",
          error: msg
        });
        recordSkip(opts, "unavailable");
        return false;
      }
    }
  };
  async function ensureWarm(gateOpts, timeoutMs, signal) {
    if (warmVectors) return warmVectors;
    if (!warmPromise) {
      warmPromise = warmExemplars(gateOpts, timeoutMs, signal).then((v) => {
        warmVectors = v;
        return v;
      });
    }
    return warmPromise;
  }
  async function warmExemplars(gateOpts, timeoutMs, signal) {
    if (exemplars.length === 0) return null;
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const results = await Promise.all(
        exemplars.map(
          (text) => gateOpts.embedder.embed({ text, signal: ac.signal, purpose: "similarity" })
        )
      );
      return results.map((r) => unitVector(r.vector));
    } catch (err) {
      if (signal.aborted) return null;
      const msg = err instanceof EmbeddingUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      gateOpts.logger?.warn?.("embedding_gate.unavailable", {
        phase: "warm",
        error: msg
      });
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}
function unitVector(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
  if (norm === 0) return v;
  const inv = 1 / Math.sqrt(norm);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i] * inv;
  return out;
}
function recordSkip(opts, reason) {
  opts.metrics?.recordRetrieveRewriterGateSkipped?.({
    gateMode: "embedding",
    reason
  });
}
export {
  createEmbeddingGate
};
