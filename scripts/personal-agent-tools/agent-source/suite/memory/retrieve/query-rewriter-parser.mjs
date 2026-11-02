const REWRITTEN_QUERY_MAX_LENGTH = 400;
const ABSTAIN_TOKEN = "NONE";
const ENVELOPE_RE = /<rewritten_query>([^<]*)<\/rewritten_query>/i;
function parseRewriterOutput(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const fromJson = parseJsonShape(trimmed);
    if (fromJson !== void 0) return fromJson;
  }
  const match = ENVELOPE_RE.exec(raw);
  if (!match) return null;
  const inner = (match[1] ?? "").trim();
  if (inner.length === 0) return null;
  if (inner === ABSTAIN_TOKEN) return null;
  if (inner.includes("\n")) return null;
  return inner.length > REWRITTEN_QUERY_MAX_LENGTH ? inner.slice(0, REWRITTEN_QUERY_MAX_LENGTH) : inner;
}
function parseJsonShape(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return void 0;
  }
  const obj = parsed;
  const field = obj["rewritten_query"];
  if (typeof field !== "string") return void 0;
  const inner = field.trim();
  if (inner.length === 0) return null;
  if (inner === ABSTAIN_TOKEN) return null;
  if (inner.includes("\n")) return null;
  return inner.length > REWRITTEN_QUERY_MAX_LENGTH ? inner.slice(0, REWRITTEN_QUERY_MAX_LENGTH) : inner;
}
export {
  REWRITTEN_QUERY_MAX_LENGTH,
  parseRewriterOutput
};
