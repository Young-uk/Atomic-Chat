import { EmbeddingUnavailableError } from "./embedding-client.mjs";
const COSINE_ONLY_MIN_SIMILARITY = 0.35;
const COSINE_ONLY_MAX_GAP = 0.15;
async function recallHybrid(deps, opts) {
  if (!deps.embeddingClient || !deps.embeddingStore) {
    return opts.bm25Hits.slice(0, opts.k);
  }
  let queryVec;
  try {
    const r = await deps.embeddingClient.embed({
      text: opts.query,
      signal: opts.signal,
      purpose: "query"
    });
    queryVec = r.vector;
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) {
      deps.metrics?.recordMemoryEmbeddingsFallback({
        reason: "embed_failed"
      });
      return opts.bm25Hits.slice(0, opts.k);
    }
    throw err;
  }
  const candidates = scanCandidates(deps.embeddingStore, deps.embeddingClient.model, deps, opts);
  const requiredTags = opts.requiredTags ?? [];
  const cosineById = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    if (!passesFilters(c, opts.workingDir, requiredTags)) continue;
    if (c.vector.length !== queryVec.length) continue;
    cosineById.set(c.memoryId, cosineSimilarity(queryVec, c.vector));
  }
  const maxBm25 = Math.max(0, ...opts.bm25Hits.map((hit) => Math.abs(hit.bm25Score)));
  const keyword = opts.bm25Hits.map((hit) => {
    const normBm25 = maxBm25 > 0 ? Math.abs(hit.bm25Score) / maxBm25 : 1;
    const cosine = Math.max(0, Math.min(1, cosineById.get(hit.id) ?? 0));
    return { entry: hit, score: deps.fts5Weight * normBm25 + deps.vectorWeight * cosine };
  }).sort((a, b) => b.score - a.score).slice(0, opts.k).map((r) => r.entry);
  const free = opts.k - keyword.length;
  if (free <= 0 || !deps.hydrate || deps.vectorWeight <= 0) return keyword;
  const keywordIds = new Set(opts.bm25Hits.map((hit) => hit.id));
  let bestCosine = 0;
  for (const cosine of cosineById.values()) if (cosine > bestCosine) bestCosine = cosine;
  const floor = Math.max(deps.minCosine ?? COSINE_ONLY_MIN_SIMILARITY, bestCosine - COSINE_ONLY_MAX_GAP);
  const meaningOnly = [...cosineById.entries()].filter(([id, cosine]) => !keywordIds.has(id) && cosine >= floor).sort((a, b) => b[1] - a[1]).slice(0, free);
  if (meaningOnly.length === 0) return keyword;
  const hydrated = new Map(deps.hydrate(meaningOnly.map(([id]) => id)).map((entry) => [entry.id, entry]));
  const extra = [];
  for (const [id] of meaningOnly) {
    const entry = hydrated.get(id);
    if (entry && passesFilters(entry, opts.workingDir, requiredTags)) extra.push(entry);
  }
  return [...keyword, ...extra];
}
function scanCandidates(store, model, deps, opts) {
  const total = store.countByModel(model);
  if (total <= deps.bruteForceCeiling) return store.listByModel(model);
  deps.metrics?.recordMemoryEmbeddingsBruteForceOverflow({
    rows: total,
    ceiling: deps.bruteForceCeiling
  });
  const byId = /* @__PURE__ */ new Map();
  for (const c of store.listNewestByModel(model, deps.bruteForceCeiling)) byId.set(c.memoryId, c);
  const missing = opts.bm25Hits.map((hit) => hit.id).filter((id) => !byId.has(id));
  for (const c of store.listByModelForMemories(model, missing)) byId.set(c.memoryId, c);
  return [...byId.values()];
}
function passesFilters(row, workingDir, requiredTags) {
  if (workingDir !== void 0 && workingDir !== null && row.workingDir !== workingDir) return false;
  return requiredTags.every((t) => row.tags.includes(t));
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dim mismatch ${a.length} vs ${b.length}`
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
export {
  COSINE_ONLY_MAX_GAP,
  COSINE_ONLY_MIN_SIMILARITY,
  cosineSimilarity,
  recallHybrid
};
