import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  NO_PROGRESS,
  PULL_REPORT_LIMITS,
  shapePullReport
} from "./git-remote-report.mjs";
import {
  gitFailureResult,
  optionalString,
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval,
  runGitRemote
} from "./git-remote-policy.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const TOOL = "os.git.pull";
const NETWORK_TIMEOUT_MS = 12e4;
function buildOsGitPullTool(options) {
  return {
    name: TOOL,
    description: "Pull from a remote branch (default: the current branch's upstream on origin). Fast-forward only unless `rebase: true`. Needs Remote sync on; asks for approval.",
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = optionalString(rawArgs.repo);
      const remote = optionalString(rawArgs.remote) ?? "origin";
      const branch = optionalString(rawArgs.branch);
      const rebase = rawArgs.rebase === true;
      const refused = refuseWhenRemoteSyncOff(TOOL, options, { remote, branch });
      if (refused) return refused;
      const root = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["rev-parse", "--show-toplevel"],
        signal: ctx.signal,
        timeoutMs: 5e3
      });
      requireGitSuccess(TOOL, root);
      const repoRoot = root.stdout.trim();
      const args = [
        "pull",
        NO_PROGRESS,
        rebase ? "--rebase" : "--ff-only",
        remote
      ];
      if (branch) args.push(branch);
      const preview = `git ${args.join(" ")}`;
      await requireGitRemoteApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          reason: `pull ${remote}${branch ? ` ${branch}` : ""} into ${repoRoot}`,
          preview,
          affectedResources: [repoRoot]
        },
        ctx.signal
      );
      const result = await runGitRemote(options, {
        repo,
        workingDir: ctx.workingDir,
        args,
        signal: ctx.signal,
        timeoutMs: NETWORK_TIMEOUT_MS
      });
      if (result.exitCode !== 0) {
        return gitFailureResult(TOOL, result, { remote, branch, rebase, repoRoot });
      }
      return compressToolResult(
        {
          tool: TOOL,
          status: "ok",
          output: `${preview}
${shapePullReport(result.stdout, result.stderr)}`,
          details: { remote, branch: branch ?? null, rebase, repoRoot }
        },
        PULL_REPORT_LIMITS
      );
    }
  };
}
export {
  buildOsGitPullTool
};
