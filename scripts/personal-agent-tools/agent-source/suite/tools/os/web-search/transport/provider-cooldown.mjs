import {
  loadCooldownFile,
  saveCooldownFile
} from "./provider-cooldown-file.mjs";
const DEFAULT_BASE_MS = 6e4;
const DEFAULT_MAX_MS = 15 * 6e4;
const MAX_HONOURED_RETRY_AFTER_MS = DEFAULT_MAX_MS;
const DEFAULT_UNREACHABLE_MS = 2 * 6e4;
const UNREACHABLE_PROBE_INTERVAL_MS = 3e4;
function createProviderCooldown(options = {}) {
  return buildCooldown(
    options,
    /* @__PURE__ */ new Map(),
    void 0
  );
}
function createPersistentProviderCooldown(options) {
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const now = options.now ?? Date.now;
  const entries = loadCooldownFile(options.filePath, now(), maxMs);
  return buildCooldown(
    options,
    entries,
    () => saveCooldownFile(options.filePath, entries)
  );
}
function buildCooldown(options, entries, persist) {
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const unreachableMs = options.unreachableMs ?? DEFAULT_UNREACHABLE_MS;
  const unreachable = /* @__PURE__ */ new Map();
  function left(entry, now) {
    return entry ? Math.max(0, entry.until - now) : 0;
  }
  function remainingMs(name, now) {
    return Math.max(
      left(entries.get(name), now),
      left(unreachable.get(name), now)
    );
  }
  return {
    remainingMs,
    isParked(name, now) {
      return remainingMs(name, now) > 0;
    },
    tagOf(name) {
      return entries.get(name)?.tag ?? unreachable.get(name)?.tag;
    },
    reasonOf(name, now) {
      if (left(entries.get(name), now) > 0) return "rate_limited";
      if (left(unreachable.get(name), now) > 0) return "unreachable";
      return void 0;
    },
    parkUnreachable(name, now, tag) {
      unreachable.set(name, {
        until: now + unreachableMs,
        ...tag !== void 0 ? { tag } : {},
        triedAt: now
      });
      return unreachableMs;
    },
    takeProbe(name, now) {
      const entry = unreachable.get(name);
      if (!entry || now - entry.triedAt < UNREACHABLE_PROBE_INTERVAL_MS) {
        return false;
      }
      entry.triedAt = now;
      return true;
    },
    park(name, now, retryAfterMs, tag) {
      const recorded = entries.get(name);
      const previous = recorded?.tag !== void 0 && tag !== void 0 && recorded.tag !== tag ? void 0 : recorded;
      const strikes = (previous?.strikes ?? 0) + 1;
      const escalated = Math.min(maxMs, baseMs * 2 ** (strikes - 1));
      const advertised = retryAfterMs === null ? 0 : Math.min(MAX_HONOURED_RETRY_AFTER_MS, Math.max(0, retryAfterMs));
      const parkMs = Math.max(escalated, advertised);
      entries.set(name, {
        until: now + parkMs,
        strikes,
        ...tag !== void 0 ? { tag } : {}
      });
      persist?.();
      return parkMs;
    },
    clear(name) {
      unreachable.delete(name);
      if (entries.delete(name)) persist?.();
    }
  };
}
function formatCooldown(ms) {
  const total = Math.max(0, Math.round(ms / 1e3));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
export {
  UNREACHABLE_PROBE_INTERVAL_MS,
  createPersistentProviderCooldown,
  createProviderCooldown,
  formatCooldown
};
