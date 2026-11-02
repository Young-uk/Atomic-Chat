function parseRetryAfterValueMs(value, now = Date.now()) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (/^\d+$/.test(text)) {
    const seconds = Number.parseInt(text, 10);
    return Number.isFinite(seconds) ? seconds * 1e3 : null;
  }
  const dateMs = Date.parse(text);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now);
}
export {
  parseRetryAfterValueMs
};
