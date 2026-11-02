const NO_PROGRESS = "--no-progress";
function renderStream(raw) {
  return raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.slice(line.lastIndexOf("\r") + 1).trimEnd()).filter((line) => line.trim().length > 0);
}
function clampLines(lines, head, tail) {
  if (lines.length <= head + tail) return lines;
  return [
    ...lines.slice(0, head),
    `\u2026 [omitted ${lines.length - head - tail} lines]`,
    ...lines.slice(-tail)
  ];
}
const PULL_STDOUT_HEAD_LINES = 14;
const PULL_STDOUT_TAIL_LINES = 2;
const PULL_STDERR_HEAD_LINES = 4;
const PULL_STDERR_TAIL_LINES = 2;
const PULL_REPORT_LINES = 26;
const DIFFSTAT_VERDICT = /^\s*\d+ files? changed/;
const PULL_REPORT_LIMITS = {
  maxTailLines: PULL_REPORT_LINES,
  maxSummaryLength: PULL_REPORT_LINES * 90
};
function shapePullReport(stdout, stderr) {
  const stdoutLines = renderStream(stdout);
  const verdictAt = stdoutLines.findIndex((line) => DIFFSTAT_VERDICT.test(line));
  const trailing = verdictAt < 0 ? 0 : stdoutLines.length - verdictAt - 1;
  const tree = clampLines(
    trailing > 0 ? stdoutLines.slice(0, verdictAt + 1) : stdoutLines,
    PULL_STDOUT_HEAD_LINES,
    PULL_STDOUT_TAIL_LINES
  );
  if (trailing > 0) tree.push(`\u2026 [omitted ${trailing} lines below the verdict]`);
  const refs = clampLines(
    renderStream(stderr),
    PULL_STDERR_HEAD_LINES,
    PULL_STDERR_TAIL_LINES
  );
  const report = [...tree, ...refs].join("\n");
  return report || "(already up to date)";
}
const FETCH_HEAD_LINES = 16;
const FETCH_TAIL_LINES = 4;
const FETCH_REPORT_LINES = 22;
const FETCH_REPORT_LIMITS = {
  maxTailLines: FETCH_REPORT_LINES,
  maxSummaryLength: FETCH_REPORT_LINES * 80
};
function shapeFetchReport(stderr) {
  const refs = clampLines(
    renderStream(stderr),
    FETCH_HEAD_LINES,
    FETCH_TAIL_LINES
  );
  return refs.join("\n") || "(already up to date)";
}
const CLONE_HEAD_LINES = 2;
const CLONE_TAIL_LINES = 8;
const CLONE_REPORT_LINES = 12;
const CLONE_REPORT_LIMITS = {
  maxTailLines: CLONE_REPORT_LINES,
  maxSummaryLength: CLONE_REPORT_LINES * 100
};
function shapeCloneReport(stderr) {
  const notes = clampLines(
    renderStream(stderr),
    CLONE_HEAD_LINES,
    CLONE_TAIL_LINES
  );
  return notes.join("\n") || "cloned";
}
export {
  CLONE_REPORT_LIMITS,
  FETCH_REPORT_LIMITS,
  NO_PROGRESS,
  PULL_REPORT_LIMITS,
  clampLines,
  renderStream,
  shapeCloneReport,
  shapeFetchReport,
  shapePullReport
};
