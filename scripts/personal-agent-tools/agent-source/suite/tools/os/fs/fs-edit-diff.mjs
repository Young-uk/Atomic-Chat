const DIFF_MAX_LINES = 40;
const PREVIEW_MAX_LEN = 800;
const DIFF_SUMMARY_MAX_LINES = DIFF_MAX_LINES + 3;
const DIFF_SUMMARY_MAX_CHARS = 4e3;
function renderUnifiedDiff(before, after, path) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const firstDiff = findFirstDiffLine(beforeLines, afterLines);
  if (firstDiff === -1) return "";
  const contextBefore = 2;
  const contextAfter = 2;
  const head = Math.max(0, firstDiff - contextBefore);
  const lastDiffBefore = findLastDiffLine(beforeLines, afterLines);
  const lastDiffAfter = findLastDiffLineFromEnd(beforeLines, afterLines);
  const tailBefore = Math.min(
    beforeLines.length - 1,
    lastDiffBefore + contextAfter
  );
  const segments = [];
  segments.push(`--- a/${path}`);
  segments.push(`+++ b/${path}`);
  for (let i = head; i <= Math.min(beforeLines.length - 1, tailBefore) && i < firstDiff; i++) {
    segments.push(` ${beforeLines[i]}`);
  }
  for (let i = firstDiff; i <= lastDiffBefore; i++) {
    segments.push(`-${beforeLines[i] ?? ""}`);
  }
  for (let i = firstDiff; i <= lastDiffAfter; i++) {
    segments.push(`+${afterLines[i] ?? ""}`);
  }
  for (let i = Math.max(lastDiffBefore + 1, firstDiff); i <= tailBefore && i < beforeLines.length; i++) {
    segments.push(` ${beforeLines[i]}`);
  }
  if (segments.length > DIFF_MAX_LINES + 2) {
    return segments.slice(0, DIFF_MAX_LINES + 2).join("\n") + "\n\u2026 [diff truncated]";
  }
  return segments.join("\n");
}
function findFirstDiffLine(before, after) {
  const limit = Math.min(before.length, after.length);
  for (let i = 0; i < limit; i++) {
    if (before[i] !== after[i]) return i;
  }
  if (before.length !== after.length) return limit;
  return -1;
}
function findLastDiffLine(before, after) {
  const len = Math.max(before.length, after.length);
  for (let i = before.length - 1, j = after.length - 1; i >= 0 && j >= 0; i--, j--) {
    if (before[i] !== after[j]) return i;
  }
  if (before.length < after.length) return -1;
  return before.length - 1 - (len - Math.max(before.length, after.length));
}
function findLastDiffLineFromEnd(before, after) {
  for (let i = after.length - 1, j = before.length - 1; i >= 0 && j >= 0; i--, j--) {
    if (after[i] !== before[j]) return i;
  }
  if (after.length > before.length) return after.length - 1;
  return -1;
}
function clampDiffPreview(text) {
  if (text.length <= PREVIEW_MAX_LEN) return text;
  return text.slice(0, PREVIEW_MAX_LEN - 15) + "\n\u2026 [truncated]";
}
export {
  DIFF_SUMMARY_MAX_CHARS,
  DIFF_SUMMARY_MAX_LINES,
  clampDiffPreview,
  renderUnifiedDiff
};
