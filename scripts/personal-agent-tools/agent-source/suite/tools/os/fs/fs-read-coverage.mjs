import { createHash } from "node:crypto";
const READ_COVERAGE_DETAIL_KEY = "readCoverage";
function hashReadContent(buffer) {
  return createHash("sha1").update(buffer).digest("hex").slice(0, 16);
}
function splitReadLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function parseReadCoverage(details) {
  const raw = details[READ_COVERAGE_DETAIL_KEY];
  if (raw === null || typeof raw !== "object") return null;
  const record = raw;
  const path = record.path;
  const contentHash = record.contentHash;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof contentHash !== "string" || contentHash.length === 0) return null;
  const startLine = asLineNumber(record.startLine);
  const endLine = asLineNumber(record.endLine);
  const totalLines = asLineNumber(record.totalLines);
  if (startLine === null || endLine === null || totalLines === null)
    return null;
  const empty = startLine === 0 && endLine === 0;
  if (!empty && (startLine < 1 || startLine > endLine)) return null;
  return {
    path,
    contentHash,
    startLine,
    endLine,
    totalLines,
    numbered: record.numbered === true,
    truncated: record.truncated === true
  };
}
function asLineNumber(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}
export {
  READ_COVERAGE_DETAIL_KEY,
  hashReadContent,
  parseReadCoverage,
  splitReadLines
};
