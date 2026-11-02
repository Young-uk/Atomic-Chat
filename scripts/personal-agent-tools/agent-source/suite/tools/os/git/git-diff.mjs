import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const osGitDiffTool = {
  name: "os.git.diff",
  description: "Show a unified diff. Args (all optional): revisionRange (e.g. 'HEAD~3..HEAD' or single 'HEAD~1'), staged (bool \u2014 --cached), paths (array of path filters), context (lines of context, default 3). Read-only.",
  readonly: true,
  async run(rawArgs, ctx) {
    const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
    const revisionRange = typeof rawArgs.revisionRange === "string" && rawArgs.revisionRange.length > 0 ? rawArgs.revisionRange : void 0;
    const staged = rawArgs.staged === true;
    const context = parseContext(rawArgs.context, 3);
    const paths = parsePaths(rawArgs.paths);
    const args = ["diff", `--unified=${context}`];
    if (staged) args.push("--cached");
    if (revisionRange) args.push(revisionRange);
    if (paths.length > 0) {
      args.push("--");
      args.push(...paths);
    }
    const result = await runGit({
      repo,
      workingDir: ctx.workingDir,
      args,
      signal: ctx.signal,
      timeoutMs: 3e4,
      maxOutputBytes: 2 * 1024 * 1024
    });
    requireGitSuccess("os.git.diff", result);
    const stats = countAddRemove(result.stdout);
    const empty = result.stdout.trim().length === 0;
    return compressToolResult(
      {
        tool: "os.git.diff",
        status: "ok",
        output: empty ? "(no diff)" : result.stdout,
        details: {
          empty,
          added: stats.added,
          removed: stats.removed,
          truncated: result.truncated,
          repoRoot: result.repoRoot,
          revisionRange: revisionRange ?? null,
          staged,
          paths
        }
      },
      { maxSummaryLength: 64 * 1024, maxTailLines: 4e3 }
    );
  }
};
function parseContext(raw, fallback) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error("os.git.diff: `context` must be a non-negative number");
  }
  return Math.floor(raw);
}
function parsePaths(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("os.git.diff: `paths` must be an array of strings");
  }
  const out = [];
  for (const p of raw) {
    if (typeof p !== "string" || p.length === 0) {
      throw new Error("os.git.diff: `paths` entries must be non-empty strings");
    }
    out.push(p);
  }
  return out;
}
function countAddRemove(diff) {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
export {
  osGitDiffTool
};
