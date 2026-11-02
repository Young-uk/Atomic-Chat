import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isInside } from "../../../approval/fanout-scope.mjs";
import { candidateRoots } from "./path-candidate-roots.mjs";
const DEFAULT_CANDIDATE_LIMITS = {
  timeBudgetMs: 300,
  maxEntries: 2e4,
  maxResults: 6
};
const SKIPPED_DIRS = new Set(
  [
    "node_modules",
    "Library",
    "AppData",
    "Applications",
    "System",
    "dist",
    "build",
    "target",
    "vendor",
    "venv",
    "__pycache__",
    "site-packages",
    "$Recycle.Bin"
  ].map((name) => name.toLowerCase())
);
function candidateName(missing) {
  const name = basename(missing.replace(/[\\/]+$/, ""));
  if (name === "" || name === "." || name === "..") return null;
  return name;
}
function nameKey(name) {
  return name.normalize("NFC").toLowerCase();
}
async function findPathCandidates(missing, roots, limits = DEFAULT_CANDIDATE_LIMITS, filter = {}) {
  const name = candidateName(missing);
  if (name === null) return { found: [], complete: true };
  const found = [];
  const state = { stopped: false, cut: false, scanned: 0 };
  const deadline = Date.now() + limits.timeBudgetMs;
  let timer;
  let timedOut = false;
  const timeout = new Promise((done) => {
    timer = setTimeout(() => {
      timedOut = true;
      done();
    }, limits.timeBudgetMs);
    timer.unref?.();
  });
  const walk = new Walk(nameKey(name), resolve(missing), limits, deadline, state, found, filter);
  const search = walk.run(roots).catch(() => {
  });
  try {
    await Promise.race([search, timeout]);
  } finally {
    state.stopped = true;
    if (timer !== void 0) clearTimeout(timer);
  }
  return {
    found: found.slice(0, limits.maxResults),
    complete: !state.cut && !(timedOut && found.length < limits.maxResults)
  };
}
class Walk {
  constructor(wanted, missing, limits, deadline, state, found, filter) {
    this.wanted = wanted;
    this.limits = limits;
    this.deadline = deadline;
    this.state = state;
    this.found = found;
    this.filter = filter;
    this.seen = /* @__PURE__ */ new Set([missing]);
    this.blocked = (filter.blocked ?? []).map((dir) => resolve(dir));
  }
  visited = /* @__PURE__ */ new Set();
  seen;
  blocked;
  async run(roots) {
    let level = roots.map((root) => ({ dir: resolve(root.dir), left: root.depth })).filter(({ dir }) => !this.isBlocked(dir));
    while (level.length > 0) {
      const next = [];
      for (const { dir, left } of level) {
        if (left <= 0 || this.visited.has(dir)) continue;
        this.visited.add(dir);
        if (this.shouldStop()) return;
        const entries = await listDir(dir);
        if (this.state.stopped) return;
        for (const entry of entries) {
          this.state.scanned++;
          const path = join(dir, entry.name);
          if (this.matches(entry, path) && this.full()) return;
          if (entry.isDirectory() && !skipped(entry.name) && !this.isBlocked(path)) {
            next.push({ dir: path, left: left - 1 });
          }
        }
      }
      level = next;
    }
  }
  /** Record `entry` when it matches; true when it was recorded. */
  matches(entry, path) {
    if (nameKey(entry.name) !== this.wanted || this.seen.has(path)) return false;
    this.seen.add(path);
    const candidate = { path, kind: kindOf(entry) };
    if (this.filter.accept !== void 0 && !this.filter.accept(candidate)) {
      return false;
    }
    this.found.push(candidate);
    return true;
  }
  full() {
    return this.found.length >= this.limits.maxResults;
  }
  shouldStop() {
    if (this.state.stopped || this.full()) return true;
    if (this.state.scanned >= this.limits.maxEntries || Date.now() >= this.deadline) {
      this.state.cut = true;
      return true;
    }
    return false;
  }
  isBlocked(dir) {
    return this.blocked.some((blocked) => isInside(blocked, dir));
  }
}
async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function skipped(name) {
  return name.startsWith(".") || SKIPPED_DIRS.has(name.toLowerCase());
}
function kindOf(entry) {
  if (entry.isDirectory()) return "folder";
  if (entry.isFile()) return "file";
  return "other";
}
export {
  DEFAULT_CANDIDATE_LIMITS,
  candidateName,
  candidateRoots,
  findPathCandidates,
  nameKey
};
