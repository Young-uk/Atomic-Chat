import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../../compressor/listing-caps.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const PATH_CHARS = 280;
const osGitStatusTool = {
  name: "os.git.status",
  description: "Show working-tree status (porcelain). Returns a structured list of changed/untracked paths plus the current branch. Read-only.",
  readonly: true,
  async run(rawArgs, ctx) {
    const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
    const [statusResult, branchResult] = await Promise.all([
      runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["status", "--porcelain=v1", "-z", "--branch"],
        signal: ctx.signal
      }),
      runGit({
        repo,
        workingDir: ctx.workingDir,
        // `symbolic-ref --short HEAD` works even on a repo without any
        // commits yet (detached vs not doesn't matter here — we just
        // want whatever HEAD currently points at, or "(detached)").
        args: ["symbolic-ref", "--short", "-q", "HEAD"],
        signal: ctx.signal,
        timeoutMs: 5e3
      })
    ]);
    requireGitSuccess("os.git.status", statusResult);
    const { entries, branchInfo } = parsePorcelain(statusResult.stdout);
    let branch = branchResult.stdout.trim();
    if (!branch) {
      const headHash = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["rev-parse", "--short", "HEAD"],
        signal: ctx.signal,
        timeoutMs: 5e3
      });
      branch = headHash.exitCode === 0 ? `(detached ${headHash.stdout.trim()})` : "(unborn)";
    }
    const human = formatHuman(branch, branchInfo, entries);
    return compressToolResult(
      {
        tool: "os.git.status",
        status: "ok",
        output: human,
        details: {
          branch,
          branchInfo,
          entries,
          clean: entries.length === 0,
          repoRoot: statusResult.repoRoot
        }
      },
      // `# branch: …` is line 1, so the default 12-line tail drops the
      // branch header first and then the earliest paths. The tool has
      // no `limit` of its own — the row count is whatever git reported
      // — so budget the rows we are about to print at PATH_CHARS each.
      // ~14 dirty paths fit the shared ceiling; past that the header
      // and the first paths survive, which is the right end of a
      // status.
      listingResultCaps(entries.length, PATH_CHARS)
    );
  }
};
function parsePorcelain(stdout) {
  if (!stdout) return { entries: [], branchInfo: null };
  const records = stdout.split("\0");
  const entries = [];
  let branchInfo = null;
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (rec === void 0 || rec === "") {
      i++;
      continue;
    }
    if (rec.startsWith("## ")) {
      branchInfo = rec.slice(3);
      i++;
      continue;
    }
    const indexStatus = rec.charAt(0);
    const workingStatus = rec.charAt(1);
    const path = rec.slice(3);
    const entry = { path, indexStatus, workingStatus };
    if (indexStatus === "R" || indexStatus === "C") {
      const orig = records[i + 1];
      if (orig !== void 0) {
        entry.renamedFrom = orig;
        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
    entries.push(entry);
  }
  return { entries, branchInfo };
}
function formatHuman(branch, branchInfo, entries) {
  const lines = [];
  lines.push(`# branch: ${branch}${branchInfo ? ` (${branchInfo})` : ""}`);
  if (entries.length === 0) {
    lines.push("(working tree clean)");
    return lines.join("\n");
  }
  for (const e of entries) {
    const mark = `${e.indexStatus || " "}${e.workingStatus || " "}`;
    const rename = e.renamedFrom ? `  (from ${e.renamedFrom})` : "";
    lines.push(`${mark} ${e.path}${rename}`);
  }
  return lines.join("\n");
}
export {
  osGitStatusTool,
  parsePorcelain
};
