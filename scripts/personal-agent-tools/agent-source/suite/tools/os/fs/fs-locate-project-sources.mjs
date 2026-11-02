import { opendir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { expandHome } from "../expand-home.mjs";
const RECENT_SESSIONS_SCAN_LIMIT = 100;
const MAX_ROOT_ENTRIES = 500;
const SKIPPED_DIR_NAMES = /* @__PURE__ */ new Set(["node_modules", "__pycache__"]);
const SOURCE_PRIORITY = {
  cwd: 0,
  "session-history": 1,
  "configured-root": 2
};
function matchTier(candidateBasename, query) {
  const base = normalizeForMatch(candidateBasename);
  if (base === query) return 0;
  if (base.startsWith(query)) return 1;
  if (base.includes(query)) return 2;
  return null;
}
function normalizeForMatch(input) {
  return input.normalize("NFC").toLowerCase();
}
function collectCwdChain(workingDir, query) {
  const out = [];
  let dir = resolve(workingDir);
  for (; ; ) {
    const tier = matchTier(basename(dir), query);
    if (tier !== null) {
      out.push({
        path: dir,
        source: "cwd",
        tier,
        recency: Number.MAX_SAFE_INTEGER
      });
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}
function collectSessionHistory(sessions, query) {
  const newestByDir = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    if (typeof s.workingDir !== "string" || s.workingDir.length === 0) continue;
    const dir = resolve(s.workingDir);
    const seen = newestByDir.get(dir);
    if (seen === void 0 || s.updatedAt > seen)
      newestByDir.set(dir, s.updatedAt);
  }
  const out = [];
  for (const [dir, updatedAt] of newestByDir) {
    const tier = matchTier(basename(dir), query);
    if (tier === null) continue;
    out.push({
      path: dir,
      source: "session-history",
      tier,
      recency: updatedAt
    });
  }
  return out;
}
async function collectConfiguredRoots(roots, query, signal) {
  const result = {
    candidates: [],
    rootsScanned: 0,
    invalidRoots: [],
    unreadableRoots: [],
    truncatedRoots: []
  };
  for (const raw of roots) {
    signal?.throwIfAborted();
    if (typeof raw !== "string") continue;
    if (raw.trim().length === 0) {
      result.invalidRoots.push(raw);
      continue;
    }
    const expanded = expandHome(raw.trim());
    if (!isAbsolute(expanded)) {
      result.invalidRoots.push(raw);
      continue;
    }
    const root = resolve(expanded);
    let dir;
    try {
      dir = await opendir(root);
    } catch {
      result.unreadableRoots.push(root);
      continue;
    }
    const rootCandidates = [];
    const rootTier = matchTier(basename(root), query);
    if (rootTier !== null) {
      rootCandidates.push({
        path: root,
        source: "configured-root",
        tier: rootTier,
        recency: 0
      });
    }
    let truncated = false;
    let eligibleSeen = 0;
    try {
      for await (const entry of dir) {
        signal?.throwIfAborted();
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
        eligibleSeen += 1;
        if (eligibleSeen > MAX_ROOT_ENTRIES) {
          truncated = true;
          break;
        }
        const tier = matchTier(entry.name, query);
        if (tier === null) continue;
        rootCandidates.push({
          path: join(root, entry.name),
          source: "configured-root",
          tier,
          recency: 0
        });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      result.unreadableRoots.push(root);
      continue;
    }
    result.rootsScanned += 1;
    if (truncated) result.truncatedRoots.push(root);
    result.candidates.push(...rootCandidates);
  }
  return result;
}
async function canonicalizePaths(candidates) {
  return Promise.all(
    candidates.map(async (c) => {
      try {
        return { ...c, path: await realpath(c.path) };
      } catch {
        return c;
      }
    })
  );
}
function dedupeByPath(candidates) {
  const byPath = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    if (!byPath.has(c.path)) byPath.set(c.path, c);
  }
  return [...byPath.values()];
}
async function dropMissingDirs(candidates) {
  const checks = await Promise.all(
    candidates.map(async (c) => {
      if (c.source === "configured-root") return c;
      try {
        return (await stat(c.path)).isDirectory() ? c : null;
      } catch {
        return null;
      }
    })
  );
  return checks.filter((c) => c !== null);
}
async function resolveDirectPath(rawName) {
  const expanded = expandHome(rawName);
  if (!isAbsolute(expanded)) return null;
  try {
    if (!(await stat(expanded)).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    return await realpath(expanded);
  } catch {
    return resolve(expanded);
  }
}
function sortCandidates(candidates) {
  return [...candidates].sort(
    (a, b) => a.tier - b.tier || SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] || b.recency - a.recency || a.path.localeCompare(b.path)
  );
}
export {
  MAX_ROOT_ENTRIES,
  RECENT_SESSIONS_SCAN_LIMIT,
  canonicalizePaths,
  collectConfiguredRoots,
  collectCwdChain,
  collectSessionHistory,
  dedupeByPath,
  dropMissingDirs,
  matchTier,
  normalizeForMatch,
  resolveDirectPath,
  sortCandidates
};
