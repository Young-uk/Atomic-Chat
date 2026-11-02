import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { listMoves } from "./fs-move-text.mjs";
const NAME = "os.fs.move";
function undoArgs(done) {
  return {
    moves: [...done].reverse().map(({ move }) => ({ from: move.dest, to: move.source }))
  };
}
const UNDO_CALL_MAX_MOVES = 3;
function undoLine(done) {
  if (done.length === 0) return "";
  const { moves } = undoArgs(done);
  if (moves.length === 1) return `To undo: os.fs.move ${JSON.stringify(moves[0])}`;
  if (moves.length <= UNDO_CALL_MAX_MOVES) {
    return `To undo: os.fs.move ${JSON.stringify({ moves })}`;
  }
  return "To undo: os.fs.move with moves = each `source \u2192 destination` line above as { from: destination, to: source } (exact absolute paths, not the original `to`).";
}
function okResult(done, notes) {
  const copied = done.filter((d) => d.method === "copy").length;
  const kept = done.flatMap((d) => d.sourceKept === void 0 ? [] : [`\u26A0 ${d.sourceKept}`]);
  const head = done.length === 1 ? `moved \`${done[0].move.from}\` to \`${done[0].move.dest}\`` : `moved ${done.length} items`;
  const across = copied > 0 ? ` (${copied} copied across drives)` : "";
  const output = [
    ...done.length > 1 ? listMoves(done.map((d) => d.move)) : [],
    ...notes,
    ...kept,
    `${head}${across}`,
    undoLine(done)
  ].join("\n");
  return compressToolResult(
    {
      tool: NAME,
      status: "ok",
      output,
      details: {
        count: done.length,
        moves: done.map(({ move, method }) => ({ from: move.source, to: move.dest, method })),
        undo: undoArgs(done)
      }
    },
    { overflow: "tail" }
  );
}
function partialResult(done, failed, total, reason, notes) {
  const output = [
    ...done.length > 0 ? ["Already moved:", ...listMoves(done.map((d) => d.move))] : [],
    ...notes,
    `moved ${done.length} of ${total}, then stopped at \`${failed.from}\` \u2192 \`${failed.dest}\`: ${reason}`,
    `Not moved: ${total - done.length} item(s), starting with \`${failed.from}\`.`,
    undoLine(done)
  ].filter((line) => line.length > 0).join("\n");
  return compressToolResult(
    {
      tool: NAME,
      status: "error",
      output,
      details: {
        count: done.length,
        total,
        failedAt: { from: failed.source, to: failed.dest, reason },
        moves: done.map(({ move, method }) => ({ from: move.source, to: move.dest, method })),
        undo: undoArgs(done)
      }
    },
    { overflow: "tail" }
  );
}
export {
  okResult,
  partialResult
};
