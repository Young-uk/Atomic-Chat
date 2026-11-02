import { isLinkKind } from "../../../memory/links/link-store.mjs";
const LINE_RE = /^LINK\s+(\d+)\s+(\d+)\s+\[kind=([A-Z_]+)\]\s*$/;
function parseLinkGeneratorOutput(raw, opts) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "none" };
  if (/^NONE\s*$/i.test(trimmed)) return { kind: "none" };
  if (looksLikeJson(trimmed)) {
    const fromJson = parseJsonShape(trimmed, opts);
    if (fromJson) return fromJson;
  }
  const max = opts.maxLinks ?? 4;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const fromId = Number(match[1]);
    const toId = Number(match[2]);
    const kindRaw = match[3] ?? "";
    if (!Number.isInteger(fromId) || fromId <= 0) continue;
    if (!Number.isInteger(toId) || toId <= 0) continue;
    if (fromId === toId) continue;
    if (!isLinkKind(kindRaw)) continue;
    if (!opts.allowlist.has(fromId)) continue;
    if (!opts.allowlist.has(toId)) continue;
    const dedupKey = `${fromId}->${toId}::${kindRaw}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ fromId, toId, kind: kindRaw });
    if (out.length >= max) break;
  }
  if (out.length === 0) return { kind: "none" };
  return { kind: "links", links: out };
}
function looksLikeJson(s) {
  return s.startsWith("{") || s.startsWith("[");
}
function parseJsonShape(raw, opts) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;
  const kindField = obj["kind"];
  if (kindField === "none") {
    return { kind: "none" };
  }
  if (kindField !== "links") {
    return null;
  }
  const linksField = obj["links"];
  if (!Array.isArray(linksField)) {
    return null;
  }
  const max = opts.maxLinks ?? 4;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of linksField) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry;
    const fromId = toPositiveInt(rec["from_id"]);
    const toId = toPositiveInt(rec["to_id"]);
    const kindRaw = typeof rec["link_kind"] === "string" ? rec["link_kind"] : "";
    if (fromId === null || toId === null) continue;
    if (fromId === toId) continue;
    if (!isLinkKind(kindRaw)) continue;
    if (!opts.allowlist.has(fromId)) continue;
    if (!opts.allowlist.has(toId)) continue;
    const dedupKey = `${fromId}->${toId}::${kindRaw}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ fromId, toId, kind: kindRaw });
    if (out.length >= max) break;
  }
  if (out.length === 0) return { kind: "none" };
  return { kind: "links", links: out };
}
function toPositiveInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}
export {
  parseLinkGeneratorOutput
};
