import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const DEFAULT_MAX_ENTRIES = 256;
function buildSearchCacheKey(provider, query, maxResults) {
  return `${provider}\0${query.trim().toLowerCase()}\0${maxResults}`;
}
function createSearchCache(options) {
  return buildCache(options, /* @__PURE__ */ new Map(), void 0);
}
function createPersistentSearchCache(options) {
  const ttlMs = Math.max(0, options.ttlMs);
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const now = options.now ?? Date.now;
  const store = ttlMs === 0 ? /* @__PURE__ */ new Map() : loadCacheFile(options.filePath, now(), maxEntries);
  const persist = ttlMs === 0 ? void 0 : () => saveCacheFile(options.filePath, store);
  return buildCache(options, store, persist);
}
function buildCache(options, store, persist) {
  const ttlMs = Math.max(0, options.ttlMs);
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const now = options.now ?? Date.now;
  return {
    get(key) {
      if (ttlMs === 0) return void 0;
      const entry = store.get(key);
      if (!entry) return void 0;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return void 0;
      }
      return entry.value.map((result) => ({ ...result }));
    },
    set(key, value) {
      if (ttlMs === 0) return;
      store.delete(key);
      store.set(key, {
        expiresAt: now() + ttlMs,
        value: value.map((result) => ({ ...result }))
      });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === void 0) break;
        store.delete(oldest);
      }
      persist?.();
    },
    get size() {
      return store.size;
    }
  };
}
function loadCacheFile(filePath, now, maxEntries) {
  const store = /* @__PURE__ */ new Map();
  let rows;
  try {
    rows = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return store;
  }
  if (!Array.isArray(rows)) return store;
  for (const row of rows) {
    if (typeof row?.key !== "string" || typeof row.expiresAt !== "number" || !Number.isFinite(row.expiresAt) || !Array.isArray(row.value)) {
      continue;
    }
    if (row.expiresAt <= now) continue;
    store.set(row.key, { expiresAt: row.expiresAt, value: row.value });
  }
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === void 0) break;
    store.delete(oldest);
  }
  return store;
}
function saveCacheFile(filePath, store) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const rows = [...store].map(([key, entry]) => ({
      key,
      expiresAt: entry.expiresAt,
      value: entry.value
    }));
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(rows), "utf8");
    renameSync(tmp, filePath);
  } catch {
  }
}
export {
  buildSearchCacheKey,
  createPersistentSearchCache,
  createSearchCache
};
