const DEFAULTS = {
  maxSummaryLength: 400,
  maxTailLines: 12,
  overflow: "head"
};
function compressToolResult(raw, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const normalised = raw.output.replace(/\r\n/g, "\n").trimEnd();
  const { text: tail, truncated: tailTruncated } = extractTail(
    normalised,
    merged.maxTailLines
  );
  const signature = extractSignature(normalised, raw.status);
  const summaryParts = [signature, tail].filter((part) => part.length > 0);
  const joined = summaryParts.join("\n");
  const overLength = joined.length > merged.maxSummaryLength;
  const summary = !overLength ? joined : merged.overflow === "tail" ? keepSummaryTail(signature, tail, merged.maxSummaryLength) : `${joined.slice(0, merged.maxSummaryLength - 15)}
\u2026 [truncated]`;
  const result = {
    tool: raw.tool,
    status: raw.status,
    summary,
    details: raw.details ?? {},
    truncated: tailTruncated || overLength
  };
  Object.defineProperty(result, "fullOutput", { value: raw.output, enumerable: false });
  Object.defineProperty(result, "fullOutputTruncated", { value: raw.details?.truncated === true, enumerable: false });
  return result;
}
function fullToolResult(result) {
  if (result.fullOutput === void 0) return result;
  return { ...result, summary: result.fullOutput, truncated: result.fullOutputTruncated === true };
}
function retainToolOutput(from, to, options = {}) {
  if (from.fullOutput !== void 0) {
    Object.defineProperty(to, "fullOutput", { value: `${options.prefix ?? ""}${from.fullOutput}`, enumerable: false });
    Object.defineProperty(to, "fullOutputTruncated", { value: options.truncated ?? from.fullOutputTruncated, enumerable: false });
  }
  return to;
}
function keepSummaryTail(signature, tail, maxSummaryLength) {
  const head = signature.length > 0 ? `${signature}
` : "";
  const marker = "\u2026 [truncated]\n";
  const room = maxSummaryLength - head.length - marker.length;
  if (room <= 0)
    return `${head}${marker}`.slice(0, Math.max(0, maxSummaryLength));
  return `${head}${marker}${tail.slice(-room)}`;
}
function extractTail(text, maxLines) {
  if (text.length === 0) return { text: "", truncated: false };
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length <= maxLines)
    return { text: lines.join("\n"), truncated: false };
  const slice = lines.slice(-maxLines);
  return {
    text: `\u2026 [omitted ${lines.length - maxLines} lines]
${slice.join("\n")}`,
    truncated: true
  };
}
const ERROR_MARKERS = [
  /error:/i,
  /failed:/i,
  /traceback \(most recent call last\)/i,
  /assertionerror/i,
  /exception:/i
];
function extractSignature(text, status) {
  if (status === "ok") return "";
  const lines = text.split("\n");
  for (const line of lines) {
    for (const pattern of ERROR_MARKERS) {
      if (pattern.test(line)) {
        return `key: ${line.trim().slice(0, 180)}`;
      }
    }
  }
  return "";
}
export {
  compressToolResult,
  fullToolResult,
  retainToolOutput
};
