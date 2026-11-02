import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { retainToolOutput } from "../../../compressor/result-compressor.mjs";
import { RESTORE_MAX_BYTES } from "./fs-restore-store.mjs";
const HEADER_SENSITIVE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".toml",
  ".ini"
]);
const NO_REPLACE_NOTE = { note: null };
async function readPriorFile(absolute) {
  let size;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    return null;
  }
  if (size > RESTORE_MAX_BYTES) {
    return { bytes: size, content: null, lines: null, firstLine: null };
  }
  try {
    const content = await readFile(absolute);
    const text = content.toString("utf8");
    return {
      bytes: content.byteLength,
      content,
      lines: countLines(text),
      firstLine: firstLine(text)
    };
  } catch {
    return { bytes: size, content: null, lines: null, firstLine: null };
  }
}
function priorFromText(text) {
  const content = Buffer.from(text, "utf8");
  return {
    bytes: content.byteLength,
    content,
    lines: countLines(text),
    firstLine: firstLine(text)
  };
}
function countLines(text) {
  if (text.length === 0) return 0;
  let newlines = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    newlines++;
  }
  return text.endsWith("\n") ? newlines : newlines + 1;
}
function firstLine(text) {
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
function isShrink(linesBefore, linesAfter) {
  return linesBefore > 0 && (linesBefore - linesAfter) * 5 >= linesBefore * 4;
}
async function guardReplacedFile(input) {
  const { prior, store } = input;
  if (store === void 0 || prior.bytes === 0) return NO_REPLACE_NOTE;
  if (await store.wasCreated(input.sessionId, input.absolute)) {
    return NO_REPLACE_NOTE;
  }
  const linesAfter = countLines(input.after);
  const shrunk = prior.lines !== null && isShrink(prior.lines, linesAfter);
  const headerChanged = input.change === "replace" && prior.firstLine !== null && HEADER_SENSITIVE_EXTENSIONS.has(extname(input.absolute).toLowerCase()) && prior.firstLine !== firstLine(input.after);
  if (input.change === "shrink" && !shrunk) return NO_REPLACE_NOTE;
  const loud = shrunk || headerChanged || prior.lines === null;
  let saved = "too_large";
  let copyFile;
  let failure = "";
  if (prior.content !== null && prior.bytes <= RESTORE_MAX_BYTES) {
    try {
      const copy = await store.saveCopy(
        input.workingDir,
        input.absolute,
        prior.content,
        {
          tool: input.tool,
          lines: prior.lines ?? 0,
          sessionId: input.sessionId
        }
      );
      saved = "saved";
      copyFile = copy.file;
    } catch (err) {
      saved = "failed";
      failure = err.message;
    }
  }
  const counts = formatCounts(prior, linesAfter, headerChanged);
  const verb = input.change === "replace" ? "replaced" : "shrank";
  const head = `${verb} the user's file \`${input.display}\` (${counts})`;
  const tail = saved === "saved" ? loud ? `the previous content is saved \u2014 \`os.fs.restore ${JSON.stringify({ path: input.display })}\` brings it back` : "previous content saved" : saved === "too_large" ? `the previous content was too large to save (over ${formatBytes(RESTORE_MAX_BYTES)})` : `the previous content could not be saved: ${failure}`;
  const note = `${loud ? "\u26A0 " : ""}${head}; ${tail}`;
  return {
    note,
    replaced: {
      path: input.absolute,
      display: input.display,
      bytesBefore: prior.bytes,
      linesBefore: prior.lines,
      linesAfter,
      shrunk,
      headerChanged,
      saved,
      ...copyFile !== void 0 ? { copy: copyFile } : {}
    }
  };
}
function withReplaceNotes(result, outcomes) {
  const noted = outcomes.filter((o) => o.note !== null);
  if (noted.length === 0) return result;
  const notes = noted.map((o) => o.note).join("\n");
  const replaced = noted.map((o) => o.replaced);
  return retainToolOutput(result, {
    ...result,
    summary: result.summary.length > 0 ? `${notes}
${result.summary}` : notes,
    details: {
      ...result.details,
      replaced: replaced.length === 1 ? replaced[0] : replaced
    }
  }, { prefix: `${notes}
` });
}
function formatCounts(prior, linesAfter, headerChanged) {
  const counts = prior.lines === null ? `${formatBytes(prior.bytes)} \u2192 ${formatLines(linesAfter)}` : `${formatLines(prior.lines)} \u2192 ${formatNumber(linesAfter)}`;
  return headerChanged ? `${counts}, header changed` : counts;
}
function formatLines(n) {
  return `${formatNumber(n)} ${n === 1 ? "line" : "lines"}`;
}
function formatNumber(n) {
  return n.toLocaleString("en-US");
}
function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
export {
  HEADER_SENSITIVE_EXTENSIONS,
  NO_REPLACE_NOTE,
  countLines,
  firstLine,
  formatBytes,
  formatLines,
  formatNumber,
  guardReplacedFile,
  isShrink,
  priorFromText,
  readPriorFile,
  withReplaceNotes
};
