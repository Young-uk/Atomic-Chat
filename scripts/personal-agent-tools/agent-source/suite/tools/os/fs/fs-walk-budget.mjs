const DEFAULT_WALK_BUDGET = {
  maxMs: 3e4,
  maxEntries: 2e5
};
function createWalkBudget(limits, deps = {}) {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let stop = null;
  return {
    check(scanned) {
      deps.signal?.throwIfAborted();
      if (stop !== null) return stop;
      const elapsedMs = now() - startedAt;
      if (scanned >= limits.maxEntries) {
        stop = { reason: "entries", elapsedMs, scanned };
      } else if (elapsedMs >= limits.maxMs) {
        stop = { reason: "time", elapsedMs, scanned };
      }
      return stop;
    }
  };
}
function describeWalkStop(stop) {
  const seconds = Math.round(stop.elapsedMs / 100) / 10;
  const limit = stop.reason === "time" ? "time limit reached" : "entry limit reached";
  return `[partial results: walk stopped after ${seconds} s / ${stop.scanned} entries scanned (${limit}); files not yet visited are missing. Narrow the pattern or the root (cwd) and retry.]`;
}
export {
  DEFAULT_WALK_BUDGET,
  createWalkBudget,
  describeWalkStop
};
