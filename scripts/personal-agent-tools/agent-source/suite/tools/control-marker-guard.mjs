const CONTROL_MARKERS = [
  // Gemma 4: turn framing, the thought channel, tool-call framing. The
  // open form is `<|x>`, the close form `<x|>` (not the `<|x|>` shape).
  "<|channel>",
  "<channel|>",
  "<|turn>",
  "<turn|>",
  "<|tool_call>",
  "<tool_call|>",
  "<|tool_response>",
  "<tool_response|>",
  // Qwen / ChatML: turn delimiters, native tool-call tags, think tags.
  // The think tags are the reasoning prelude's own sentinels — only their
  // appearance INSIDE an argument string is wrong, which is all this
  // module ever looks at.
  "<|im_start|>",
  "<|im_end|>",
  "<tool_call>",
  "</tool_call>",
  "<think>",
  "</think>",
  // Gemma 3: turn delimiters.
  "<start_of_turn>",
  "<end_of_turn>"
];
const GENERIC_CONTROL_MARKER = /<\|[a-z_]+\|>/;
const CONTENT_ARGUMENTS = /* @__PURE__ */ new Map([
  ["os.fs.write", /* @__PURE__ */ new Set(["content"])],
  ["os.fs.edit", /* @__PURE__ */ new Set(["oldString", "newString"])],
  ["os.fs.patch", /* @__PURE__ */ new Set(["patch"])]
]);
const PATCH_LINE_PREFIX = "[+ -]?";
const EXCERPT_BEFORE = 8;
const EXCERPT_AFTER = 16;
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const MARKER_ALTERNATION = [
  ...CONTROL_MARKERS.map(escapeRegExp),
  GENERIC_CONTROL_MARKER.source
].join("|");
const ANYWHERE = new RegExp(MARKER_ALTERNATION);
const EVERYWHERE = new RegExp(MARKER_ALTERNATION, "g");
const NEUTRALISED_MARKER = "[special token removed]";
function neutraliseControlMarkers(text) {
  return text.replace(EVERYWHERE, NEUTRALISED_MARKER);
}
const LINE_START = new RegExp(`^(?:${MARKER_ALTERNATION})`, "m");
const PATCH_LINE_START = new RegExp(
  `^${PATCH_LINE_PREFIX}(?:${MARKER_ALTERNATION})`,
  "m"
);
function findControlMarkers(args, tool) {
  const hits = [];
  const contentKeys = tool !== void 0 ? CONTENT_ARGUMENTS.get(tool) : void 0;
  for (const [key, value] of Object.entries(args)) {
    const pattern = contentKeys?.has(key) === true ? tool === "os.fs.patch" ? PATCH_LINE_START : LINE_START : ANYWHERE;
    walk(value, key, pattern, hits);
  }
  return hits;
}
function walk(value, path, pattern, hits) {
  if (typeof value === "string") {
    const hit = scan(value, pattern);
    if (hit !== null) hits.push({ path, ...hit });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, pattern, hits));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, `${path}.${key}`, pattern, hits);
    }
  }
}
function scan(value, pattern) {
  const match = pattern.exec(value);
  if (match === null) return null;
  const marker = match[0].replace(/^[+ -](?=<)/, "");
  const index = match.index + (match[0].length - marker.length);
  return { marker, index, excerpt: excerptAround(value, index, marker) };
}
function excerptAround(value, index, marker) {
  const start = Math.max(0, index - EXCERPT_BEFORE);
  const end = Math.min(value.length, index + marker.length + EXCERPT_AFTER);
  const body = value.slice(start, end).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return `${start > 0 ? "\u2026" : ""}${body}${end < value.length ? "\u2026" : ""}`;
}
const DESCRIBED_HITS_MAX = 3;
function describeCorruptedCall(hits) {
  const described = hits.slice(0, DESCRIBED_HITS_MAX).map(
    (hit) => `argument \`${hit.path}\` contains a model control marker (\`${hit.marker}\` at char ${hit.index}: "${hit.excerpt}")`
  );
  const rest = hits.length - described.length;
  const more = rest > 0 ? `; and ${rest} more argument(s)` : "";
  return `corrupted tool call: ${described.join("; ")}${more}. The call was not run \u2014 re-emit it with clean arguments.`;
}
export {
  CONTENT_ARGUMENTS,
  CONTROL_MARKERS,
  GENERIC_CONTROL_MARKER,
  NEUTRALISED_MARKER,
  describeCorruptedCall,
  findControlMarkers,
  neutraliseControlMarkers
};
