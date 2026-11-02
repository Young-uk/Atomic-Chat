class EmbeddingUnavailableError extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.name = "EmbeddingUnavailableError";
    if (cause !== void 0) this.cause = cause;
  }
}
function promptedEmbeddingText(req, prompts) {
  if (!prompts || !req.purpose) return req.text;
  return `${prompts[req.purpose]}${req.text}`;
}
class LlamaEmbeddingClient {
  dim;
  model;
  url;
  timeoutMs;
  fetchFn;
  getApiKey;
  refreshApiKey;
  prompts;
  constructor(opts) {
    if (!Number.isInteger(opts.dim) || opts.dim <= 0) {
      throw new Error(
        `LlamaEmbeddingClient: dim must be a positive integer, got ${opts.dim}`
      );
    }
    this.dim = opts.dim;
    this.model = opts.model;
    this.url = opts.url.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 1e4;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.getApiKey = opts.getApiKey ?? (() => null);
    this.refreshApiKey = opts.refreshApiKey;
    this.prompts = opts.prompts;
  }
  async embed(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const signal = mergeSignals(req.signal, ctrl.signal);
    try {
      const headers = {
        "content-type": "application/json"
      };
      const apiKey = this.getApiKey();
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const body = JSON.stringify({ content: promptedEmbeddingText(req, this.prompts) });
      const send = () => this.fetchFn(`${this.url}/embedding`, { method: "POST", headers, body, signal });
      let res = await send();
      if (res.status === 401 && this.refreshApiKey) {
        const fresh = await this.refreshApiKey().catch(() => null);
        if (fresh && headers.authorization !== `Bearer ${fresh}`) {
          void res.body?.cancel().catch(() => void 0);
          headers.authorization = `Bearer ${fresh}`;
          res = await send();
        }
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "(no body)");
        throw new EmbeddingUnavailableError(
          `embedding daemon returned HTTP ${res.status}: ${txt.slice(0, 200)}`
        );
      }
      const raw = extractEmbeddingArray(await res.json());
      if (!raw) {
        throw new EmbeddingUnavailableError(
          "embedding daemon response shape unrecognised"
        );
      }
      if (raw.length !== this.dim) {
        throw new EmbeddingUnavailableError(
          `embedding dim mismatch: expected ${this.dim}, got ${raw.length}`
        );
      }
      const out = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) out[i] = raw[i];
      return { vector: out, model: this.model };
    } catch (err) {
      if (err instanceof EmbeddingUnavailableError) throw err;
      throw new EmbeddingUnavailableError(
        `embedding request failed: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
function extractEmbeddingArray(body) {
  if (Array.isArray(body)) {
    const first = body[0];
    if (first && first.embedding !== void 0) {
      return unwrapEmbeddingField(first.embedding);
    }
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const obj = body;
  if (obj.embedding !== void 0) {
    const unwrapped = unwrapEmbeddingField(obj.embedding);
    if (unwrapped) return unwrapped;
  }
  if (Array.isArray(obj.data) && obj.data[0]?.embedding) {
    return obj.data[0].embedding;
  }
  return null;
}
function unwrapEmbeddingField(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (typeof value[0] === "number") return value;
  if (Array.isArray(value[0]) && typeof value[0][0] === "number") {
    return value[0];
  }
  return null;
}
function mergeSignals(a, b) {
  if (!a) return b;
  const ctrl = new AbortController();
  const onAbortA = () => ctrl.abort(a.reason);
  const onAbortB = () => ctrl.abort(b.reason);
  if (a.aborted) ctrl.abort(a.reason);
  else if (b.aborted) ctrl.abort(b.reason);
  else {
    a.addEventListener("abort", onAbortA, { once: true });
    b.addEventListener("abort", onAbortB, { once: true });
  }
  return ctrl.signal;
}
export {
  EmbeddingUnavailableError,
  LlamaEmbeddingClient,
  promptedEmbeddingText
};
