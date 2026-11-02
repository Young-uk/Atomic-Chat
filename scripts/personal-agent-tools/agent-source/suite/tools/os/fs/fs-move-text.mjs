import { basename, dirname } from "node:path";
const PREVIEW_MAX_MOVES = 12;
const LIST_MAX_MOVES = 40;
function describeMoves(plan) {
  if (plan.length === 1) {
    const move = plan[0];
    const kind = move.folder ? "folder " : "";
    if (dirname(move.source) === dirname(move.dest)) {
      return `rename ${kind}${basename(move.source)} to ${basename(move.dest)} in ${dirname(move.dest)}${replacing(plan)}`;
    }
    return `move ${kind}${move.source} to ${move.dest}${replacing(plan)}`;
  }
  const folders = new Set(plan.map((m) => dirname(m.dest)));
  const where = folders.size === 1 ? [...folders][0] : `${folders.size} folders`;
  return `move ${plan.length} items to ${where}${replacing(plan)}`;
}
function replacing(plan) {
  const n = plan.filter((m) => m.replaces).length;
  if (n === 0) return "";
  return n === 1 ? ", replacing 1 existing file" : `, replacing ${n} existing files`;
}
function listMoves(plan, max = LIST_MAX_MOVES) {
  const lines = plan.slice(0, max).map(
    (m) => `${m.source} \u2192 ${m.dest}${m.replaces ? " (replaces existing file)" : ""}`
  );
  if (plan.length > max) lines.push(`\u2026 +${plan.length - max} more`);
  return lines;
}
function previewMoves(plan) {
  return listMoves(plan, PREVIEW_MAX_MOVES).join("\n");
}
export {
  LIST_MAX_MOVES,
  PREVIEW_MAX_MOVES,
  describeMoves,
  listMoves,
  previewMoves
};
