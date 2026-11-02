const MAX_RETRY_AFTER_MS = 1e4;
const DEFAULT_SEARCH_RETRY_POLICY = {
  maxRetries: 2,
  baseDelayMs: 500
};
function parseRetryAfterMs(headerValue, now) {
  if (typeof headerValue !== "string") return null;
  const raw = headerValue.trim();
  if (raw.length === 0) return null;
  if (/^\d+$/.test(raw)) {
    const seconds = Number.parseInt(raw, 10);
    if (!Number.isFinite(seconds)) return null;
    return clampDelay(seconds * 1e3);
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return clampDelay(at - now);
}
function computeRetryDelayMs(input) {
  if (input.retryAfterMs !== null) return clampDelay(input.retryAfterMs);
  const exponent = Math.max(0, input.attempt - 1);
  return clampDelay(input.policy.baseDelayMs * 2 ** exponent);
}
function clampDelay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
export {
  DEFAULT_SEARCH_RETRY_POLICY,
  MAX_RETRY_AFTER_MS,
  computeRetryDelayMs,
  parseRetryAfterMs
};
