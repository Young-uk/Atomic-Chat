import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval
} from "./git-remote-policy.mjs";
import {
  githubAuthGitEnv,
  isGithubHttpsRemote,
  resolveGithubToken,
  scrubGithubToken
} from "../../../github/index.mjs";
import { requireBranchName } from "./git-checkout.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
function buildOsGitPushTool(options) {
  const resolveToken = options.resolveToken ?? (() => resolveGithubToken());
  return {
    name: "os.git.push",
    description: "Push a branch to a remote. Args: `remote` (default origin), `branch` (default: current branch), `setUpstream` (default true \u2014 `-u` so later pushes need no args), `repo` (optional path). Uses the GitHub token from the Integrations tab for github.com remotes. Needs Remote sync on (Integrations \u2192 GitHub). No force-push. Asks for approval \u2014 this is the moment a repository leaves the machine.",
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
      const remote = typeof rawArgs.remote === "string" && rawArgs.remote.trim() ? requireBranchName(rawArgs.remote, "os.git.push") : "origin";
      const branch = rawArgs.branch === void 0 || rawArgs.branch === null ? await currentBranch(repo, ctx) : requireBranchName(rawArgs.branch, "os.git.push");
      const setUpstream = rawArgs.setUpstream !== false && !await hasUpstream(repo, ctx, branch);
      const refused = refuseWhenRemoteSyncOff(
        "os.git.push",
        // An embedder or a test that never injected the predicate reads
        // as "nobody said this repository may leave" — closed.
        { ...options, isRemoteSyncEnabled: options.isRemoteSyncEnabled ?? (() => false) },
        { remote, branch }
      );
      if (refused) return refused;
      const remoteUrl = await readRemoteUrl(repo, ctx, remote);
      const invocation = buildPushInvocation({
        remote,
        branch,
        setUpstream,
        remoteUrl,
        token: resolveToken()
      });
      await requireGitRemoteApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: "os.git.push",
          reason: `push ${branch} to ${remote}`,
          preview: `git ${invocation.args.join(" ")}
remote: ${remoteUrl}${invocation.authenticated ? "\nauth: GitHub token from the Integrations tab" : ""}`,
          affectedResources: [remoteUrl]
        },
        ctx.signal
      );
      const result = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: invocation.args,
        env: invocation.env,
        signal: ctx.signal,
        timeoutMs: 12e4
      });
      if (result.exitCode !== 0) {
        throw new Error(
          scrubGithubToken(
            `os.git.push: git push exited with ${result.exitCode}: ${result.stderr.trim() || "(no stderr)"}`
          )
        );
      }
      requireGitSuccess("os.git.push", result);
      const output = scrubGithubToken(
        result.stderr.split(/\r?\n/).filter((l) => l.trim().length > 0 && !/^remote:\s*$/.test(l)).join("\n") || `pushed ${branch} to ${remote}`
      );
      return compressToolResult({
        tool: "os.git.push",
        status: "ok",
        output,
        details: {
          remote,
          branch,
          setUpstream,
          authenticated: invocation.authenticated,
          remoteUrl,
          repoRoot: result.repoRoot
        }
      });
    }
  };
}
function buildPushInvocation(input) {
  const args = [
    "push",
    ...input.setUpstream ? ["-u"] : [],
    input.remote,
    `${input.branch}:${input.branch}`
  ];
  const useToken = input.token !== null && isGithubHttpsRemote(input.remoteUrl);
  return {
    args,
    env: useToken ? githubAuthGitEnv(input.token) : {},
    authenticated: useToken
  };
}
async function currentBranch(repo, ctx) {
  const res = await runGit({
    repo,
    workingDir: ctx.workingDir,
    args: ["symbolic-ref", "--short", "-q", "HEAD"],
    signal: ctx.signal,
    timeoutMs: 5e3
  });
  const branch = res.stdout.trim();
  if (res.exitCode !== 0 || branch.length === 0) {
    throw new Error(
      "os.git.push: HEAD is detached \u2014 pass `branch` explicitly or check out a branch first"
    );
  }
  return branch;
}
async function hasUpstream(repo, ctx, branch) {
  const res = await runGit({
    repo,
    workingDir: ctx.workingDir,
    args: ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
    signal: ctx.signal,
    timeoutMs: 5e3
  });
  return res.exitCode === 0 && res.stdout.trim().length > 0;
}
async function readRemoteUrl(repo, ctx, remote) {
  const res = await runGit({
    repo,
    workingDir: ctx.workingDir,
    args: ["remote", "get-url", "--push", remote],
    signal: ctx.signal,
    timeoutMs: 5e3
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `os.git.push: remote ${JSON.stringify(remote)} is not configured: ${res.stderr.trim()}`
    );
  }
  return res.stdout.trim();
}
export {
  buildOsGitPushTool,
  buildPushInvocation
};
