import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
const GIT_FAILURE_SUMMARY_CHARS = 2e3;
const GIT_FAILURE_TAIL_LINES = 20;
function buildGitErrorResult(tool, message, details = {}) {
  return compressToolResult(
    {
      tool,
      status: "error",
      output: message,
      details: { ...details, error: message }
    },
    {
      maxSummaryLength: GIT_FAILURE_SUMMARY_CHARS,
      maxTailLines: GIT_FAILURE_TAIL_LINES
    }
  );
}
function describeGitFailure(result) {
  const shown = result.args.filter((arg) => arg !== "--no-pager").join(" ");
  if (result.timedOut) {
    return `git ${shown} timed out after ${result.durationMs}ms`;
  }
  const text = [result.stderr.trim(), result.stdout.trim()].filter((part) => part.length > 0).join("\n");
  return text || `git ${shown} exited with ${result.exitCode}`;
}
export {
  GIT_FAILURE_SUMMARY_CHARS,
  GIT_FAILURE_TAIL_LINES,
  buildGitErrorResult,
  describeGitFailure
};
