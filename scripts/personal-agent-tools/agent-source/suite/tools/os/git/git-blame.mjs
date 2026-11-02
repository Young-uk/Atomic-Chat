import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const osGitBlameTool = {
  name: "os.git.blame",
  description: "Show per-line authorship for a file. Args: `path` (required), `revision` (default 'HEAD'), `startLine`/`endLine` (optional 1-based range). Returns structured blame entries.",
  readonly: true,
  async run(rawArgs, ctx) {
    const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
    const path = rawArgs.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("os.git.blame: `path` must be a non-empty string");
    }
    const revision = typeof rawArgs.revision === "string" && rawArgs.revision.length > 0 ? rawArgs.revision : "HEAD";
    const startLine = parseLine(rawArgs.startLine, "startLine");
    const endLine = parseLine(rawArgs.endLine, "endLine");
    if (startLine !== void 0 && endLine !== void 0 && endLine < startLine) {
      throw new Error("os.git.blame: endLine must be >= startLine");
    }
    const args = ["blame", "--porcelain"];
    if (startLine !== void 0 || endLine !== void 0) {
      const lo = startLine ?? 1;
      const hi = endLine ?? startLine ?? lo;
      args.push("-L", `${lo},${hi}`);
    }
    args.push(revision, "--", path);
    const result = await runGit({
      repo,
      workingDir: ctx.workingDir,
      args,
      signal: ctx.signal,
      timeoutMs: 3e4,
      maxOutputBytes: 4 * 1024 * 1024
    });
    requireGitSuccess("os.git.blame", result);
    const entries = parsePorcelainBlame(result.stdout);
    const human = formatBlame(entries);
    return compressToolResult(
      {
        tool: "os.git.blame",
        status: "ok",
        output: human,
        details: {
          path,
          revision,
          lineCount: entries.length,
          entries,
          repoRoot: result.repoRoot
        }
      },
      { maxSummaryLength: 64 * 1024, maxTailLines: 4e3 }
    );
  }
};
function parseLine(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    throw new Error(`os.git.blame: \`${field}\` must be a positive integer`);
  }
  return Math.floor(raw);
}
function parsePorcelainBlame(stdout) {
  const lines = stdout.split(/\r?\n/);
  const commits = /* @__PURE__ */ new Map();
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    const headerLine = lines[i];
    if (!headerLine) {
      i++;
      continue;
    }
    const headerMatch = headerLine.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }
    const sha = headerMatch[1];
    const resultLine = Number(headerMatch[2]);
    i++;
    let author = commits.get(sha)?.author ?? "(unknown)";
    let authorTime = commits.get(sha)?.authorTime ?? "";
    while (i < lines.length) {
      const extLine = lines[i];
      if (extLine === void 0) break;
      if (extLine.startsWith("	")) {
        const content = extLine.slice(1);
        commits.set(sha, { author, authorTime });
        entries.push({
          line: resultLine,
          commit: sha.slice(0, 12),
          author,
          authorTime,
          content
        });
        i++;
        break;
      }
      const spaceIdx = extLine.indexOf(" ");
      if (spaceIdx === -1) {
        i++;
        continue;
      }
      const key = extLine.slice(0, spaceIdx);
      const value = extLine.slice(spaceIdx + 1);
      if (key === "author") author = value;
      else if (key === "author-time") {
        const secs = Number(value);
        if (Number.isFinite(secs)) {
          authorTime = new Date(secs * 1e3).toISOString();
        }
      }
      i++;
    }
  }
  return entries;
}
function formatBlame(entries) {
  return entries.map(
    (e) => `${e.commit}  (${e.author.padEnd(16)}  ${e.authorTime.slice(0, 10)})  ${String(e.line).padStart(5)} | ${e.content}`
  ).join("\n");
}
export {
  osGitBlameTool
};
