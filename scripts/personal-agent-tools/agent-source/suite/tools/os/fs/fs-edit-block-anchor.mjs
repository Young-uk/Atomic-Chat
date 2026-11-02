import {
  lineSpan,
  splitLines
} from "./fs-edit-match.mjs";
const BLOCK_ANCHOR_MIN_SIMILARITY = 0.75;
const MIN_BLOCK_LINES = 3;
const MAX_DISTANCE_CELLS = 25e4;
function findBlockAnchorMatch(source, oldString) {
  const needle = trimBlankEdges(oldString.split("\n").map((line) => line.trim()));
  if (needle.length < MIN_BLOCK_LINES) return { kind: "none" };
  const first = needle[0];
  const last = needle[needle.length - 1];
  const lines = splitLines(source);
  const trimmed = lines.map((line) => line.text.trim());
  const slack = Math.max(1, Math.floor(needle.length / 4));
  const candidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (trimmed[i] !== first) continue;
    for (let j = i + 2; j < lines.length; j += 1) {
      if (trimmed[j] !== last) continue;
      if (Math.abs(j - i + 1 - needle.length) <= slack) {
        candidates.push({ from: i, to: j });
      }
      break;
    }
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1) {
    return { kind: "ambiguous", count: candidates.length };
  }
  const { from, to } = candidates[0];
  const block = trimmed.slice(from, to + 1);
  if (middleSimilarity(block, needle) < BLOCK_ANCHOR_MIN_SIMILARITY) {
    return { kind: "none" };
  }
  return {
    kind: "unique",
    match: lineSpan(source, oldString, lines[from], lines[to])
  };
}
function trimBlankEdges(lines) {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === "") from += 1;
  while (to > from && lines[to - 1] === "") to -= 1;
  return lines.slice(from, to);
}
function middleSimilarity(block, needle) {
  const count = Math.max(block.length, needle.length) - 2;
  if (count <= 0) return 1;
  const paired = Math.min(block.length, needle.length) - 2;
  let total = 0;
  for (let k = 1; k <= paired; k += 1) {
    total += lineSimilarity(block[k], needle[k]);
  }
  return total / count;
}
function lineSimilarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  if (a.length * b.length > MAX_DISTANCE_CELLS) return a === b ? 1 : 0;
  return 1 - editDistance(a, b) / longest;
}
function editDistance(a, b) {
  if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}
export {
  BLOCK_ANCHOR_MIN_SIMILARITY,
  findBlockAnchorMatch,
  lineSimilarity
};
