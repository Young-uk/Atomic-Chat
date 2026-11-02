const VERIFY_RUN_SUMMARY_MAX_CHARS = 4e3;
const LIST_LINES = 8;
function listLines(label, entries) {
  if (entries === void 0 || entries.length === 0) return [];
  const shown = entries.slice(0, LIST_LINES).map((e) => `  - ${e}`);
  const more = entries.length > LIST_LINES ? [`  \u2026 +${entries.length - LIST_LINES} more`] : [];
  return [`${label} (${entries.length}):`, ...shown, ...more];
}
function checkLine(c) {
  return `${c.ok ? "ok" : "FAIL"} check \`${c.check}\` \u2014 ${c.detail}`;
}
function outcomeLine(r) {
  if (r.error !== void 0) return r.error;
  if (r.kind === "command") {
    const exit = r.exitCode === null ? r.timedOut ? "killed: timed out" : "killed by signal" : `exit ${r.exitCode}`;
    return `${exit} after ${r.durationMs} ms`;
  }
  if (r.kind === "service") {
    const ready = r.ready ? `ready in ${r.readyMs} ms` : "never ready";
    const requests = r.requests ?? [];
    const failed = requests.filter((q) => !q.ok).length;
    return `${ready}; ${requests.length} request(s), ${failed} failed`;
  }
  return `page ran ${Math.round(r.durationMs / 100) / 10}s: ${r.errors?.length ?? 0} uncaught error(s), ${r.consoleErrors?.length ?? 0} console error(s), ${r.missingSelectors?.length ?? 0} failed selector lookup(s)`;
}
function tailBlock(label, tail, budget) {
  if (tail === void 0 || tail.trim().length === 0 || budget <= 40) return [];
  const text = tail.length > budget ? `\u2026${tail.slice(-(budget - 1))}` : tail;
  return [`${label}:`, text];
}
function renderVerifyRunSummary(r) {
  const checks = r.checks ?? [];
  const failing = checks.filter((c) => !c.ok);
  const passing = checks.filter((c) => c.ok);
  const head = `verify.run ${r.kind}: ${r.ok ? "ok" : "FAILED"}${r.isolated ? "" : " (ran in place \u2014 not isolated)"}`;
  const lines = [head, ...failing.map(checkLine), outcomeLine(r)];
  if (r.hint !== void 0) lines.push(`note: ${r.hint}`);
  lines.push(...listLines("uncaught errors", r.errors));
  lines.push(...listLines("console errors", r.consoleErrors));
  lines.push(...listLines("missing selectors", r.missingSelectors));
  lines.push(...listLines("failed requests", (r.requests ?? []).filter((q) => !q.ok).map((q) => `${q.method} ${q.url} \u2192 ${q.status ?? "no response"}${q.error === void 0 ? "" : ` (${q.error})`}`)));
  lines.push(...listLines("request failures", r.requestFailures));
  lines.push(...listLines("console warnings", r.consoleWarnings));
  if (r.probes !== void 0) {
    for (const [name, samples] of Object.entries(r.probes)) {
      const first = samples[0]?.[1];
      const last = samples[samples.length - 1]?.[1];
      lines.push(`probe ${name}: ${JSON.stringify(first)} \u2192 ${JSON.stringify(last)} (${samples.length} samples)`);
    }
  }
  lines.push(...passing.map(checkLine));
  let summary = lines.join("\n");
  const remaining = VERIFY_RUN_SUMMARY_MAX_CHARS - summary.length;
  const stderr = tailBlock("stderr (tail)", r.stderrTail, Math.min(1500, remaining - 40));
  const stdout = tailBlock("stdout (tail)", r.stdoutTail, Math.min(1500, remaining - 40 - stderr.join("\n").length));
  summary = [summary, ...stderr, ...stdout].join("\n");
  if (summary.length > VERIFY_RUN_SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, VERIFY_RUN_SUMMARY_MAX_CHARS - 12)}
\u2026 [clipped]`;
  }
  return summary;
}
export {
  VERIFY_RUN_SUMMARY_MAX_CHARS,
  renderVerifyRunSummary
};
