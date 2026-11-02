const NEAREST_FRAGMENT_MAX_CHARS = 160;
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (; ; ) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ start, end, text: text.slice(start, end).trimEnd() });
    if (newline === -1) return lines;
    start = newline + 1;
  }
}
function contentLines(lines) {
  return lines.filter((line) => line.text.length > 0);
}
function findLooseEditMatch(source, oldString) {
  return findLineBlockMatch(source, oldString);
}
function findLineBlockMatch(source, oldString, key = (line) => line, accept) {
  const needleText = contentLines(splitLines(oldString)).map((line) => line.text);
  if (needleText.length === 0) return { kind: "none" };
  const needle = needleText.map(key);
  const hay = contentLines(splitLines(source));
  const hayText = hay.map((line) => line.text);
  const hayKeys = hayText.map(key);
  const hits = [];
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let same = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hayKeys[i + j] !== needle[j]) {
        same = false;
        break;
      }
    }
    if (same && (accept === void 0 || accept(hayText, i, needleText))) {
      hits.push(i);
    }
  }
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", count: hits.length };
  const first = hay[hits[0]];
  const last = hay[hits[0] + needle.length - 1];
  return { kind: "unique", match: lineSpan(source, oldString, first, last) };
}
function lineSpan(source, oldString, first, last) {
  let start = first.start;
  let end = last.start + last.text.length;
  if (oldString.startsWith("\n") && start > 0) {
    start -= source.slice(start - 2, start) === "\r\n" ? 2 : 1;
  }
  if (/\n$/.test(oldString)) {
    const lineEnd = last.end;
    end = source[lineEnd] === "\n" ? lineEnd + 1 : lineEnd;
  }
  return { start, end };
}
function countSpans(spans) {
  if (spans.length === 0) return { kind: "none" };
  if (spans.length > 1) return { kind: "ambiguous", count: spans.length };
  return { kind: "unique", match: spans[0] };
}
function occurrences(haystack, needle, keep = () => true) {
  const spans = [];
  if (needle.length === 0) return spans;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    if (keep(at, at + needle.length)) spans.push({ start: at, end: at + needle.length });
  }
  return spans;
}
function matchLineEndings(newString, replaced) {
  if (!replaced.includes("\r\n")) return newString;
  return newString.replace(/\r?\n/g, "\r\n");
}
function nearestFragment(source, oldString) {
  const wanted = new Set(
    contentLines(splitLines(oldString)).map((line) => line.text.trim())
  );
  if (wanted.size === 0) return null;
  const lines = splitLines(source);
  const span = Math.max(1, splitLines(oldString).length);
  let best = { score: 0, from: 0 };
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].text.length === 0 || !wanted.has(lines[i].text.trim())) {
      continue;
    }
    let score = 0;
    for (let j = i; j < Math.min(lines.length, i + span); j += 1) {
      if (wanted.has(lines[j].text.trim()) && lines[j].text.length > 0) {
        score += 1;
      }
    }
    if (score > best.score) best = { score, from: i };
  }
  if (best.score === 0) return null;
  const to = Math.min(lines.length, best.from + span) - 1;
  const fragment = source.slice(lines[best.from].start, lines[to].end);
  const quoted = JSON.stringify(fragment);
  return quoted.length > NEAREST_FRAGMENT_MAX_CHARS ? `${quoted.slice(0, NEAREST_FRAGMENT_MAX_CHARS)}\u2026` : quoted;
}
export {
  NEAREST_FRAGMENT_MAX_CHARS,
  countSpans,
  findLineBlockMatch,
  findLooseEditMatch,
  lineSpan,
  matchLineEndings,
  nearestFragment,
  occurrences,
  splitLines
};
