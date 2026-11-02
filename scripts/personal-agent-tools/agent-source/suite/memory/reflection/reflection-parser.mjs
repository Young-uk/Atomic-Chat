const NOTE_BODY_MAX_LENGTH = 500;
const NOTE_MAX_TAGS = 8;
const NOTE_TAG_MAX_LENGTH = 40;
function parseReflectionOutput(raw) {
  const text = raw.trim();
  if (text.length === 0 || text === "NONE") {
    return { kind: "none", facts: [], notes: [], evolves: [] };
  }
  const byKey = /* @__PURE__ */ new Map();
  const notes = [];
  const evolvesByTarget = /* @__PURE__ */ new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    const set = parseSetLine(trimmed);
    if (set) {
      byKey.set(set.key, set);
      continue;
    }
    const note = parseNoteLine(trimmed);
    if (note) {
      notes.push(note);
      continue;
    }
    const evolve = parseEvolveLine(trimmed);
    if (evolve) evolvesByTarget.set(evolve.targetId, evolve);
  }
  if (byKey.size === 0 && notes.length === 0 && evolvesByTarget.size === 0) {
    return { kind: "none", facts: [], notes: [], evolves: [] };
  }
  const facts = [];
  for (const fact of byKey.values()) facts.push(fact);
  const evolves = [];
  for (const evolve of evolvesByTarget.values()) evolves.push(evolve);
  return { kind: "facts", facts, notes, evolves };
}
const EVOLVE_RE = /^EVOLVE\s+#(\d+)\s+\[tags=([^\]]*)\]\s*$/;
const EVOLVE_TAG_MAX_LENGTH = 40;
const EVOLVE_MAX_TAGS = 10;
function parseEvolveLine(line) {
  const match = EVOLVE_RE.exec(line);
  if (!match) return null;
  const targetId = Number(match[1]);
  if (!Number.isInteger(targetId) || targetId <= 0) return null;
  const addTags = extractEvolveTags(match[2] ?? "");
  if (addTags.length === 0) return null;
  return { targetId, addTags };
}
function extractEvolveTags(raw) {
  const parts = raw.split(",").map((t) => t.trim().toLowerCase()).filter(
    (t) => /^[a-z0-9][a-z0-9_-]*$/.test(t) && t.length <= EVOLVE_TAG_MAX_LENGTH
  );
  const deduped = [];
  for (const tag of parts) {
    if (deduped.length >= EVOLVE_MAX_TAGS) break;
    if (!deduped.includes(tag)) deduped.push(tag);
  }
  return deduped;
}
function parseSetLine(line) {
  if (!line.startsWith("SET ")) return null;
  let body = line.slice(4);
  let pinned = true;
  let keywords = [];
  let supersedes = null;
  let validFrom = null;
  const markerMatch = body.match(/\s*\[([^\]]*)\]\s*$/);
  if (markerMatch && /pinned\s*=|keywords\s*=|valid_from\s*=|supersedes\s*=/.test(
    markerMatch[1] ?? ""
  )) {
    const inner = markerMatch[1] ?? "";
    body = body.slice(0, markerMatch.index ?? 0).trimEnd();
    const extracted = extractSetMarker(inner);
    pinned = extracted.pinned;
    keywords = extracted.keywords;
    supersedes = extracted.supersedes;
    validFrom = extracted.validFrom;
  }
  const eq = body.indexOf("=");
  if (eq <= 0) return null;
  const key = body.slice(0, eq).trim();
  const value = body.slice(eq + 1);
  if (key.length === 0 || value.length === 0) return null;
  return {
    key,
    value,
    pinned,
    keywords: pinned ? [] : keywords,
    supersedes,
    validFrom
  };
}
const SET_KEYWORD_MAX_LENGTH = 40;
const SET_KEYWORDS_MAX = 8;
function extractSetMarker(inner) {
  let pinned = true;
  let keywords = [];
  let supersedes = null;
  let validFrom = null;
  const topClauses = inner.split(";");
  for (const rawClause of topClauses) {
    const clause = rawClause.trim();
    if (clause.length === 0) continue;
    const eqIdx = clause.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = clause.slice(0, eqIdx).trim().toLowerCase();
    const rhs = clause.slice(eqIdx + 1).trim();
    if (name === "pinned") {
      pinned = rhs.toLowerCase() !== "false";
    } else if (name === "keywords") {
      keywords = parseKeywordList(rhs);
    } else if (name === "supersedes") {
      supersedes = parseSupersedesKey(rhs);
    } else if (name === "valid_from") {
      validFrom = parseValidFromMarker(rhs);
    } else if (name.endsWith(" pinned") || name.endsWith(",pinned")) {
    }
  }
  if (keywords.length === 0 && /keywords\s*=/.test(inner) && !/;/.test(inner)) {
    const kwIdx = inner.toLowerCase().indexOf("keywords");
    if (kwIdx >= 0) {
      const rhs = inner.slice(kwIdx).split("=").slice(1).join("=").trim();
      keywords = parseKeywordList(rhs);
      const pinnedMatch = inner.match(/pinned\s*=\s*([a-zA-Z]+)/);
      if (pinnedMatch) {
        pinned = pinnedMatch[1].toLowerCase() !== "false";
      }
    }
  }
  return { pinned, keywords, supersedes, validFrom };
}
const SUPERSEDES_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,119}$/;
function parseSupersedesKey(rhs) {
  const trimmed = rhs.trim();
  if (trimmed.length === 0) return null;
  return SUPERSEDES_KEY_PATTERN.test(trimmed) ? trimmed : null;
}
function parseValidFromMarker(rhs) {
  return rhs.trim().toLowerCase() === "now" ? "now" : null;
}
function parseKeywordList(raw) {
  const normalised = raw.replace(/^\[|\]$/g, "");
  const parts = normalised.split(",").map((k) => k.trim().toLowerCase()).filter(
    (k) => k.length > 0 && k.length <= SET_KEYWORD_MAX_LENGTH && /^[a-z0-9][a-z0-9 _\-./]*$/.test(k)
  );
  const deduped = [];
  for (const kw of parts) {
    if (deduped.length >= SET_KEYWORDS_MAX) break;
    if (!deduped.includes(kw)) deduped.push(kw);
  }
  return deduped;
}
function parseNoteLine(line) {
  if (!line.startsWith("NOTE ")) return null;
  let payload = line.slice(5).trim();
  if (payload.length === 0) return null;
  let typeTag = null;
  const typeMatch = payload.match(/^\[type=([a-z]+)\]\s+/);
  if (typeMatch) {
    const typeValue = typeMatch[1] ?? "";
    if (NOTE_TYPE_ALLOWLIST.has(typeValue)) {
      typeTag = `type:${typeValue}`;
    }
    payload = payload.slice(typeMatch[0].length).trim();
    if (payload.length === 0) return null;
  }
  let body = payload;
  let tags = [];
  const tagMatch = payload.match(/\s*\[tags=([^\]]*)\]\s*$/);
  if (tagMatch) {
    body = payload.slice(0, tagMatch.index ?? payload.length - tagMatch[0].length).trimEnd();
    tags = extractTags(tagMatch[1] ?? "");
  }
  if (body.length === 0) return null;
  const clampedBody = body.length > NOTE_BODY_MAX_LENGTH ? body.slice(0, NOTE_BODY_MAX_LENGTH) : body;
  if (typeTag !== null) {
    const merged = [typeTag];
    for (const tag of tags) {
      if (!merged.includes(tag) && merged.length < NOTE_MAX_TAGS) {
        merged.push(tag);
      }
    }
    return { body: clampedBody, tags: merged };
  }
  return { body: clampedBody, tags };
}
const NOTE_TYPE_ALLOWLIST = /* @__PURE__ */ new Set([
  "event",
  "behavior",
  "knowledge",
  "skill"
]);
function extractTags(raw) {
  const parts = raw.split(",").map((t) => t.trim().toLowerCase()).filter(
    (t) => /^[a-z0-9][a-z0-9_-]*$/.test(t) && t.length <= NOTE_TAG_MAX_LENGTH
  );
  const deduped = [];
  for (const tag of parts) {
    if (deduped.length >= NOTE_MAX_TAGS) break;
    if (!deduped.includes(tag)) deduped.push(tag);
  }
  return deduped;
}
export {
  parseReflectionOutput
};
