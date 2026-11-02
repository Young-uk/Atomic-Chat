import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../../compressor/listing-caps.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const RS = "";
const US = "";
const LOG_FORMAT = `%H${US}%h${US}%an${US}%ae${US}%aI${US}%s${US}%b${RS}`;
const COMMIT_CHARS = 240;
const osGitLogTool = {
  name: "os.git.log",
  description: "Show commit history. Optional args: limit (default 20), revisionRange (e.g. 'main..HEAD'), path (filter by file). Returns structured commit records.",
  readonly: true,
  async run(rawArgs, ctx) {
    const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
    const limit = parseLimit(rawArgs.limit, 20);
    const revisionRange = parseOptionalString(rawArgs.revisionRange);
    const filterPath = parseOptionalString(rawArgs.path);
    const args = [
      "log",
      `--pretty=format:${LOG_FORMAT}`,
      `-n`,
      String(limit)
    ];
    if (revisionRange) args.push(revisionRange);
    if (filterPath) args.push("--", filterPath);
    const result = await runGit({
      repo,
      workingDir: ctx.workingDir,
      args,
      signal: ctx.signal,
      timeoutMs: 2e4
    });
    requireGitSuccess("os.git.log", result);
    const entries = parseLog(result.stdout);
    const human = formatHumanLog(entries);
    return compressToolResult(
      {
        tool: "os.git.log",
        status: "ok",
        output: human,
        details: {
          count: entries.length,
          entries,
          revisionRange: revisionRange ?? null,
          path: filterPath ?? null,
          repoRoot: result.repoRoot
        }
      },
      // `git log` is newest-first and `formatHumanLog` spends TWO
      // lines on each commit, so the default 12-line tail keeps the
      // OLDEST four and the 385-char head-slice then leaves ~2. Budget
      // the commits we actually asked git for: `limit` (20 by default,
      // 1000 max) x COMMIT_CHARS — a default call asks for ~5 KB and
      // is held to the shared ceiling; `limit: 1000` asks for 240 KB
      // and gets the ceiling too, which carried 35-41 real commits on
      // the two repos it was measured against (the row width is a
      // commit subject, so it is repo-dependent) — against the four
      // the compressor defaults left.
      listingResultCaps(limit, COMMIT_CHARS)
    );
  }
};
function parseLimit(raw, fallback) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error("os.git.log: `limit` must be a positive number");
  }
  return Math.min(1e3, Math.floor(raw));
}
function parseOptionalString(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string" || raw.length === 0) return void 0;
  return raw;
}
function parseLog(stdout) {
  if (!stdout) return [];
  const records = stdout.split(RS);
  const entries = [];
  for (const rec of records) {
    const trimmed = rec.replace(/^\n+/, "");
    if (!trimmed) continue;
    const fields = trimmed.split(US);
    if (fields.length < 7) continue;
    const [hash, shortHash, author, authorEmail, date, subject, body] = fields;
    const entry = {
      hash,
      shortHash,
      author,
      authorEmail,
      date,
      subject
    };
    const cleanBody = body?.replace(/\n+$/, "");
    if (cleanBody) entry.body = cleanBody;
    entries.push(entry);
  }
  return entries;
}
function formatHumanLog(entries) {
  if (entries.length === 0) return "(no commits)";
  return entries.map((e) => `${e.shortHash}  ${e.date}  ${e.author}
    ${e.subject}`).join("\n");
}
export {
  osGitLogTool
};
