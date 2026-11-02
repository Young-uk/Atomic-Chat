import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../../compressor/listing-caps.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const BRANCH_CHARS = 240;
const osGitBranchTool = {
  name: "os.git.branch",
  description: "List branches. Args (all optional): `includeRemote` (default false), `contains` (commit-ish \u2014 filter branches containing the commit), `pattern` (shell-glob filter applied by git).",
  readonly: true,
  async run(rawArgs, ctx) {
    const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
    const includeRemote = rawArgs.includeRemote === true;
    const contains = typeof rawArgs.contains === "string" && rawArgs.contains.length > 0 ? rawArgs.contains : void 0;
    const pattern = typeof rawArgs.pattern === "string" && rawArgs.pattern.length > 0 ? rawArgs.pattern : void 0;
    const format = "%(refname)%00%(refname:short)%00%(objectname)%00%(contents:subject)";
    const args = ["for-each-ref", "--format", format];
    if (contains) args.push(`--contains=${contains}`);
    args.push("refs/heads");
    if (includeRemote) args.push("refs/remotes");
    const [refsResult, currentResult] = await Promise.all([
      runGit({
        repo,
        workingDir: ctx.workingDir,
        args,
        signal: ctx.signal
      }),
      runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["symbolic-ref", "--short", "-q", "HEAD"],
        signal: ctx.signal,
        timeoutMs: 5e3
      })
    ]);
    requireGitSuccess("os.git.branch", refsResult);
    const currentBranch = currentResult.stdout.trim() || null;
    let branches = parseBranches(refsResult.stdout, currentBranch);
    if (pattern) {
      const re = globToRegExp(pattern);
      branches = branches.filter((b) => re.test(b.name));
    }
    return compressToolResult(
      {
        tool: "os.git.branch",
        status: "ok",
        output: formatBranches(branches, currentBranch),
        details: {
          currentBranch,
          includeRemote,
          contains: contains ?? null,
          pattern: pattern ?? null,
          count: branches.length,
          branches,
          repoRoot: refsResult.repoRoot
        }
      },
      // `# current: …` is line 1 and is the first thing the default
      // 12-line tail drops. No `limit` here either — `for-each-ref`
      // returns every matching ref — so budget the refs we are about
      // to print at BRANCH_CHARS each. ~16 refs fit the shared
      // ceiling; a repo with more should be narrowed with `pattern` or
      // `contains`, which the description already offers.
      listingResultCaps(branches.length, BRANCH_CHARS)
    );
  }
};
function parseBranches(stdout, currentBranch) {
  const out = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw) continue;
    const parts = raw.split("\0");
    if (parts.length < 4) continue;
    const [fullRef, name, hash, subject] = parts;
    if (!name) continue;
    if (name.endsWith("/HEAD")) continue;
    const isRemote = fullRef.startsWith("refs/remotes/");
    const isCurrent = !isRemote && currentBranch !== null && name === currentBranch;
    out.push({ name, isCurrent, isRemote, hash, subject });
  }
  return out;
}
function formatBranches(branches, currentBranch) {
  const lines = [];
  if (currentBranch) lines.push(`# current: ${currentBranch}`);
  else lines.push("# current: (detached)");
  for (const b of branches) {
    const mark = b.isCurrent ? "*" : " ";
    lines.push(`${mark} ${b.name}  ${b.hash.slice(0, 12)}  ${b.subject}`);
  }
  return lines.join("\n");
}
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withWildcards}$`);
}
export {
  osGitBranchTool
};
