import { extname } from "node:path";
import {
  checkFileParses,
  displayPath,
  formatParseWarning,
  isParseCheckedPath,
  PARSE_CHECK_MAX_CHARS
} from "./fs-parse-check.mjs";
const HTML_EXTENSIONS = /* @__PURE__ */ new Set([".html", ".htm"]);
const DOUBLE_ESCAPE_MIN_LITERALS = 4;
const TRANSCRIPT_MARKERS = [
  "assistant_tool_call:",
  "tool_result[",
  "<|channel|>",
  "<|turn>"
];
const TRANSCRIPT_MARKUP_LINE = /^(assistant_tool_call:|tool_result\[|<\|channel\|>|<\|turn>)/gm;
function checkWrittenContent(path, content) {
  if (content.length > PARSE_CHECK_MAX_CHARS) return [];
  try {
    const warnings = [];
    if (HTML_EXTENSIONS.has(extname(path).toLowerCase())) {
      warnings.push(...checkHtml(path, content));
    }
    const markup = checkTranscriptMarkup(content);
    if (markup !== null) warnings.push(markup);
    const escaped = checkDoubleEscaped(content);
    if (escaped !== null) warnings.push(escaped);
    return warnings;
  } catch {
    return [];
  }
}
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CLASSIC_SCRIPT_TYPE = /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$|^$/i;
function checkHtml(path, content) {
  const warnings = [];
  let index = 0;
  for (const match of content.matchAll(SCRIPT_BLOCK)) {
    index += 1;
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "";
    if (!CLASSIC_SCRIPT_TYPE.test(type)) continue;
    const startLine = lineOf(content, match.index ?? 0);
    const check = checkFileParses(
      `${path}.script${index}.js`,
      "\n".repeat(startLine - 1) + body
    );
    if (check.kind !== "error") continue;
    warnings.push({
      kind: "html_script",
      key: `script${index}`,
      count: 1,
      message: `inline <script> #${index} does not parse: ${check.message}`
    });
  }
  const close = content.search(/<\/html\s*>/i);
  if (close !== -1) {
    const end = content.indexOf(">", close) + 1;
    const trailing = content.slice(end);
    if (trailing.trim().length > 0) {
      warnings.push({
        kind: "html_trailing",
        key: "trailing",
        count: trailing.length,
        message: `${trailing.length} chars of content after </html> (from line ${lineOf(content, end)}) \u2014 nothing belongs after the closing tag; remove it`
      });
    }
  }
  return warnings;
}
function checkTranscriptMarkup(content) {
  const hits = Array.from(content.matchAll(TRANSCRIPT_MARKUP_LINE));
  const first = hits[0];
  if (first === void 0) return null;
  const marker = TRANSCRIPT_MARKERS.find((m) => first[0].startsWith(m)) ?? first[0];
  const line = lineOf(content, first.index ?? 0);
  const more = hits.length > 1 ? ` and ${hits.length - 1} more line(s)` : "";
  return {
    kind: "transcript_markup",
    key: marker,
    count: hits.length,
    message: `line ${line}${more} starts with \`${marker}\` \u2014 that is agent transcript markup, not file content; remove it`
  };
}
function checkDoubleEscaped(content) {
  const literal = (content.match(/(?<!\\)\\n/g) ?? []).length;
  if (literal < DOUBLE_ESCAPE_MIN_LITERALS) return null;
  const real = (content.match(/\n/g) ?? []).length;
  if (literal <= real) return null;
  return {
    kind: "double_escaped",
    key: "newlines",
    count: literal,
    message: `${literal} literal \\n sequences but ${real} real newline(s) \u2014 the content looks escaped twice; write it with real newlines`
  };
}
function lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}
function newContentWarnings(path, before, after) {
  const now = checkWrittenContent(path, after);
  if (before === void 0 || now.length === 0) return now;
  const earlier = new Map(
    checkWrittenContent(path, before).map((w) => [`${w.kind}:${w.key}`, w])
  );
  return now.filter((w) => {
    const prior = earlier.get(`${w.kind}:${w.key}`);
    return prior === void 0 || w.count > prior.count;
  });
}
function checkChangedFile(input) {
  const path = displayPath(input.absolute, input.workingDir);
  const lines = [];
  if (isParseCheckedPath(input.absolute)) {
    const parse = formatParseWarning({
      path,
      change: input.change,
      after: checkFileParses(input.absolute, input.after),
      ...input.before !== void 0 ? { before: checkFileParses(input.absolute, input.before) } : {},
      ...input.replacedOccurrences !== void 0 ? { replacedOccurrences: input.replacedOccurrences } : {}
    });
    if (parse !== null) lines.push(parse);
  }
  const content = input.change === "write" ? checkWrittenContent(input.absolute, input.after) : newContentWarnings(input.absolute, input.before, input.after);
  for (const warning of content) lines.push(`\u26A0 ${path}: ${warning.message}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
export {
  DOUBLE_ESCAPE_MIN_LITERALS,
  checkChangedFile,
  checkWrittenContent,
  newContentWarnings
};
