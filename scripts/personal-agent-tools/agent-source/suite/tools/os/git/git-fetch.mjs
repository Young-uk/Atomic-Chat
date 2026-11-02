import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  FETCH_REPORT_LIMITS,
  NO_PROGRESS,
  shapeFetchReport
} from "./git-remote-report.mjs";
import {
  gitFailureResult,
  optionalString,
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval,
  runGitRemote
} from "./git-remote-policy.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const TOOL = "os.git.fetch";
const NETWORK_TIMEOUT_MS = 12e4;
function buildOsGitFetchTool(options) {
  return {
    name: TOOL,
    description: "Fetch from a remote (default: origin; `all: true` for every remote). `prune` drops deleted remote branches. Needs Remote sync on; asks for approval. Does not change the working tree.",
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = optionalString(rawArgs.repo);
      const remote = optionalString(rawArgs.remote) ?? "origin";
      const all = rawArgs.all === true;
      const prune = rawArgs.prune === true;
      const refused = refuseWhenRemoteSyncOff(TOOL, options, { remote, all });
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
      const args = ["fetch", NO_PROGRESS];
      if (prune) args.push("--prune");
      if (all) args.push("--all");
      else args.push(remote);
      const preview = `git ${args.join(" ")}`;
      await requireGitRemoteApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          reason: `fetch ${all ? "all remotes" : remote} in ${repoRoot}`,
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
        return gitFailureResult(TOOL, result, { remote, all, prune, repoRoot });
      }
      return compressToolResult(
        {
          tool: TOOL,
          status: "ok",
          output: `${preview}
${shapeFetchReport(result.stderr)}`,
          details: { remote: all ? null : remote, all, prune, repoRoot }
        },
        FETCH_REPORT_LIMITS
      );
    }
  };
}
export {
  buildOsGitFetchTool
};
