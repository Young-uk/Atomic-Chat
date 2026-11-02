import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { buildGitErrorResult, describeGitFailure } from "./git-error-result.mjs";
import {
  formatGitCommandLine,
  requireGitMutationApproval
} from "./git-mutation-approval.mjs";
import { hasHeadCommit, resolveGitToplevel } from "./git-repo-probe.mjs";
import { runGit } from "./git-runner.mjs";
import { parsePorcelain } from "./git-status.mjs";
const TOOL = "os.git.add";
const MAX_LISTED_PATHS = 20;
function buildOsGitAddTool(options) {
  return {
    name: TOOL,
    description: "Stage changes: `all: true` runs `git add -A`, `paths` runs `git add -- <paths>`. `unstage: true` reverses it (`git restore --staged`). One of `all` / `paths` is required. Requires approval like a file write in the repository.",
    readonly: false,
    async run(rawArgs, ctx) {
      const parsed = parseArgs(rawArgs);
      if (!parsed.ok) return buildGitErrorResult(TOOL, parsed.message);
      const args = parsed.value;
      const probe = { repo: args.repo, workingDir: ctx.workingDir, signal: ctx.signal };
      const toplevel = await resolveGitToplevel(probe);
      if (!toplevel.ok) return buildGitErrorResult(TOOL, `${TOOL}: ${toplevel.message}`);
      const unborn = !await hasHeadCommit(probe);
      const gitArgs = buildGitArgs(args, unborn);
      await requireGitMutationApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          repoRoot: toplevel.root,
          reason: `git ${args.unstage ? "unstage" : "add"} in ${toplevel.root}`,
          preview: formatGitCommandLine(gitArgs),
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      const result = await runGit({ ...probe, args: gitArgs });
      if (result.exitCode !== 0) {
        return buildGitErrorResult(TOOL, describeGitFailure(result), {
          repoRoot: toplevel.root
        });
      }
      const status = await runGit({
        ...probe,
        args: ["status", "--porcelain=v1", "-z"]
      });
      if (status.exitCode !== 0) {
        return buildGitErrorResult(TOOL, describeGitFailure(status), {
          repoRoot: toplevel.root
        });
      }
      const { entries } = parsePorcelain(status.stdout);
      const counts = countIndex(entries);
      const staged = entries.filter(isStaged).map((e) => e.path);
      return compressToolResult({
        tool: TOOL,
        status: "ok",
        output: formatOutput(args, toplevel.root, counts, staged),
        details: {
          repoRoot: toplevel.root,
          action: args.unstage ? "unstage" : "add",
          all: args.all,
          paths: args.paths,
          unborn,
          counts,
          staged
        }
      });
    }
  };
}
function parseArgs(rawArgs) {
  const repo = typeof rawArgs.repo === "string" && rawArgs.repo.length > 0 ? rawArgs.repo : void 0;
  const all = rawArgs.all === true;
  const unstage = rawArgs.unstage === true;
  const rawPaths = rawArgs.paths;
  let paths = [];
  if (rawPaths !== void 0 && rawPaths !== null) {
    if (!Array.isArray(rawPaths) || !rawPaths.every((p) => typeof p === "string" && p.trim().length > 0)) {
      return {
        ok: false,
        message: `${TOOL}: \`paths\` must be an array of non-empty strings`
      };
    }
    paths = rawPaths.map((p) => p.trim());
  }
  if (all && paths.length > 0) {
    return {
      ok: false,
      message: `${TOOL}: pass either \`all: true\` or \`paths\`, not both`
    };
  }
  if (!all && paths.length === 0) {
    return {
      ok: false,
      message: `${TOOL}: nothing selected \u2014 pass \`all: true\` to ${unstage ? "unstage" : "stage"} everything, or \`paths: [...]\` for specific files`
    };
  }
  const value = { paths, all, unstage };
  if (repo !== void 0) value.repo = repo;
  return { ok: true, value };
}
function buildGitArgs(args, unborn) {
  const pathspec = args.all ? [] : ["--", ...args.paths];
  if (!args.unstage) {
    return args.all ? ["add", "-A"] : ["add", ...pathspec];
  }
  if (unborn) return ["reset", "-q", ...pathspec];
  return args.all ? ["reset", "-q"] : ["restore", "--staged", ...pathspec];
}
function isStaged(entry) {
  return entry.indexStatus !== " " && entry.indexStatus !== "?" && entry.indexStatus !== "!";
}
function isUnstaged(entry) {
  return entry.workingStatus !== " " && entry.workingStatus !== "?" && entry.workingStatus !== "!";
}
function countIndex(entries) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const entry of entries) {
    if (entry.indexStatus === "?") {
      untracked++;
      continue;
    }
    if (isStaged(entry)) staged++;
    if (isUnstaged(entry)) unstaged++;
  }
  return { staged, unstaged, untracked };
}
function formatOutput(args, root, counts, staged) {
  const what = args.all ? "all changes" : `${args.paths.length} path(s)`;
  const lines = [
    `${args.unstage ? "unstaged" : "staged"} ${what} in ${root}`,
    `index: ${counts.staged} staged, ${counts.unstaged} modified (unstaged), ${counts.untracked} untracked`
  ];
  for (const path of staged.slice(0, MAX_LISTED_PATHS)) lines.push(`  staged: ${path}`);
  if (staged.length > MAX_LISTED_PATHS) {
    lines.push(`  \u2026 ${staged.length - MAX_LISTED_PATHS} more staged`);
  }
  return lines.join("\n");
}
export {
  buildOsGitAddTool
};
