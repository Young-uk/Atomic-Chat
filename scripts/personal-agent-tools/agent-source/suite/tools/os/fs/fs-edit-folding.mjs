import {
  countSpans,
  findLineBlockMatch,
  occurrences,
  splitLines
} from "./fs-edit-match.mjs";
const ESCAPE = /\\(\r?\n|[ntr'"`\\$])/g;
function unescapeText(text) {
  return text.replace(
    ESCAPE,
    (_match, char) => char === "n" || char.endsWith("\n") ? "\n" : char === "t" ? "	" : char === "r" ? "\r" : char
  );
}
function findUnescaped(source, oldString) {
  const plain = unescapeText(oldString);
  if (plain !== oldString) {
    const direct = occurrences(source, plain);
    if (direct.length === 0 && source.includes("\r\n")) {
      direct.push(...occurrences(source, plain.replace(/\r?\n/g, "\r\n")));
    }
    if (direct.length > 0) return countSpans(direct);
  }
  if (!source.includes("\\")) return { kind: "none" };
  return countSpans(escapedLineRuns(source, plain));
}
function escapedLineRuns(source, plain) {
  const body = plain.endsWith("\n") ? plain.slice(0, -1) : plain;
  const lines = splitLines(source);
  const most = body.split("\n").length;
  const spans = [];
  for (let i = 0; i < lines.length && spans.length < 2; i += 1) {
    const first = source.slice(lines[i].start, lines[i].end).replace(/\r$/, "");
    if (!first.endsWith("\\") && !body.startsWith(unescapeText(first))) continue;
    for (let size = 1; size <= most && i + size <= lines.length; size += 1) {
      const start = lines[i].start;
      const lineEnd = lines[i + size - 1].end;
      const span = lineEnd - start;
      if (span > 2 * body.length + size) break;
      if (span < body.length) continue;
      const block = source.slice(start, lineEnd).replace(/\r$/gm, "");
      if (!block.includes("\\") || unescapeText(block) !== body) continue;
      const end = body === plain ? lineEnd - (source[lineEnd - 1] === "\r" ? 1 : 0) : Math.min(source.length, lineEnd + 1);
      spans.push({ start, end });
      break;
    }
  }
  return spans;
}
const TYPOGRAPHIC = /[‐-―−‘-‟  -   　]/g;
function foldTypography(text) {
  return text.replace(TYPOGRAPHIC, (char) => {
    const code = char.charCodeAt(0);
    if (code >= 8208 && code <= 8213 || code === 8722) return "-";
    if (code >= 8216 && code <= 8219) return "'";
    if (code >= 8220 && code <= 8223) return '"';
    return " ";
  });
}
function findTypographic(source, oldString) {
  const folded = foldTypography(source);
  const needle = foldTypography(oldString);
  if (folded === source && needle === oldString) return { kind: "none" };
  const direct = countSpans(occurrences(folded, needle));
  if (direct.kind !== "none") return direct;
  return findLineBlockMatch(source, oldString, (line) => foldTypography(line.trimStart()));
}
export {
  findTypographic,
  findUnescaped,
  foldTypography,
  unescapeText
};
