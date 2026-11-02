import { findBlockAnchorMatch } from "./fs-edit-block-anchor.mjs";
import { findTypographic, findUnescaped } from "./fs-edit-folding.mjs";
import {
  countSpans,
  findLineBlockMatch,
  matchLineEndings,
  occurrences
} from "./fs-edit-match.mjs";
const LEVELS = [
  {
    id: "whitespace",
    relaxation: "blank lines and trailing spaces were ignored",
    find: (source, oldString) => findLineBlockMatch(source, oldString)
  },
  {
    id: "boundary",
    relaxation: "its leading and trailing whitespace was trimmed",
    find: findTrimmedBoundary
  },
  {
    id: "indentation",
    relaxation: "its overall indentation was ignored (the lines' indentation relative to each other still matched)",
    find: (source, oldString) => findLineBlockMatch(source, oldString, (line) => line.trimStart(), sameRelativeIndent)
  },
  {
    id: "line-trim",
    relaxation: "each line's leading and trailing whitespace was ignored",
    find: (source, oldString) => findLineBlockMatch(source, oldString, (line) => line.trimStart())
  },
  {
    id: "inner-whitespace",
    relaxation: "every run of whitespace was treated as one space",
    find: findCollapsedWhitespace
  },
  {
    id: "escapes",
    relaxation: 'backslash escapes such as \\n, \\t and \\" were read as the characters they stand for',
    find: findUnescaped
  },
  {
    id: "typography",
    relaxation: "curly quotes, typographic dashes and non-breaking spaces were read as their plain ASCII forms",
    find: findTypographic
  },
  {
    id: "block-anchor",
    relaxation: "its first and last lines matched and the lines between them were similar but not identical",
    find: findBlockAnchorMatch
  }
];
const CHECK_INDENT = " newString was inserted as sent, so check its indentation against the file's.";
const CAUTION = {
  indentation: CHECK_INDENT,
  "line-trim": CHECK_INDENT,
  "inner-whitespace": CHECK_INDENT,
  escapes: " newString was inserted as sent, so check its backslash escapes.",
  "block-anchor": " The whole block was replaced, including the lines that differed."
};
function findTolerantEditMatch(source, oldString, newString) {
  for (const level of LEVELS) {
    const lookup = level.find(source, oldString);
    if (lookup.kind === "none") continue;
    if (lookup.kind === "ambiguous") {
      return { kind: "ambiguous", level: level.id, count: lookup.count };
    }
    const { start, end } = lookup.match;
    const replaced = source.slice(start, end);
    if (isDisproportionate(replaced, oldString)) return { kind: "none" };
    const shifted = level.id === "indentation" ? reindent(newString, oldString, replaced) : null;
    const sent = level.id === "boundary" ? trimLikeOldString(newString, oldString) : shifted ?? newString;
    return {
      kind: "unique",
      level: level.id,
      match: lookup.match,
      replacement: matchLineEndings(sent, replaced),
      reindented: shifted !== null
    };
  }
  return { kind: "none" };
}
const REINDENTED = " newString's lines were shifted by the same indentation, in the file's whitespace.";
function tolerantMatchNote(level, reindented = false) {
  const caution = reindented ? REINDENTED : CAUTION[level] ?? "";
  return `note: oldString was not found exactly; it matched one place once ${relaxationOf(level)}, and the edit was applied there.${caution} Check the diff.`;
}
function commonIndent(text) {
  let common = null;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const indent = leadingWhitespace(line);
    if (common === null || indent.length < common.length) common = indent;
  }
  return common ?? "";
}
function reindent(newString, oldString, replaced) {
  const theirs = commonIndent(replaced);
  const ours = commonIndent(oldString);
  if (theirs === ours) return null;
  const lines = newString.split("\n");
  const blank = (line) => line.trim().length === 0;
  if (!lines.every((line) => blank(line) || line.startsWith(ours))) return null;
  return lines.map((line) => blank(line) ? line : theirs + line.slice(ours.length)).join("\n");
}
function tolerantAmbiguityMessage(level, count) {
  return `os.fs.edit: \`oldString\` was not found exactly, and once ${relaxationOf(level)} it matches ${count} places, so nothing was changed. Include more surrounding lines, copied exactly from the file.`;
}
function relaxationOf(level) {
  return LEVELS.find((candidate) => candidate.id === level).relaxation;
}
function isDisproportionate(replaced, oldString) {
  const oldLines = oldString.split("\n").length;
  const spanLines = replaced.split("\n").length;
  if (spanLines >= Math.max(oldLines + 3, oldLines * 2)) return true;
  const oldLength = oldString.trim().length;
  return oldLines > 1 && replaced.trim().length > Math.max(oldLength + 500, oldLength * 4);
}
function leadingWhitespace(text) {
  return text.slice(0, text.length - text.trimStart().length);
}
function trailingWhitespace(text) {
  return text.slice(text.trimEnd().length);
}
function keepsEdges(source, oldString) {
  const lead = leadingWhitespace(oldString).length > 0;
  const trail = trailingWhitespace(oldString).length > 0;
  const edge = (at) => at < 0 || at >= source.length || /\s/.test(source[at]);
  return (start, end) => (!lead || edge(start - 1)) && (!trail || edge(end));
}
function findTrimmedBoundary(source, oldString) {
  const core = oldString.trim();
  if (core === oldString || core.length === 0) return { kind: "none" };
  return countSpans(occurrences(source, core, keepsEdges(source, oldString)));
}
function trimLikeOldString(newString, oldString) {
  const lead = leadingWhitespace(oldString);
  const trail = trailingWhitespace(oldString);
  if (newString.length < lead.length + trail.length) return newString;
  let result = newString;
  if (lead.length > 0 && result.startsWith(lead)) result = result.slice(lead.length);
  if (trail.length > 0 && result.endsWith(trail)) result = result.slice(0, result.length - trail.length);
  return result;
}
function sameRelativeIndent(hay, start, needle) {
  const window = hay.slice(start, start + needle.length);
  const dedent = (lines) => {
    const indents = lines.map(leadingWhitespace);
    const common = Math.min(...indents.map((indent) => indent.length));
    return indents.map((indent) => indent.slice(common));
  };
  const theirs = dedent(window);
  const ours = dedent(needle);
  return theirs.every((indent, j) => indent === ours[j]);
}
function findCollapsedWhitespace(source, oldString) {
  const words = oldString.trim().split(/\s+/);
  if (words.length < 2) return { kind: "none" };
  const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"), "g");
  const keep = keepsEdges(source, oldString);
  const spans = [];
  for (let hit = pattern.exec(source); hit !== null && spans.length < 2; hit = pattern.exec(source)) {
    const end = hit.index + hit[0].length;
    if (keep(hit.index, end)) spans.push({ start: hit.index, end });
  }
  return countSpans(spans);
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export {
  findTolerantEditMatch,
  tolerantAmbiguityMessage,
  tolerantMatchNote
};
