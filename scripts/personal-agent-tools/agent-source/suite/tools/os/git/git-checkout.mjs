import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { buildGitErrorResult, describeGitFailure } from "./git-error-result.mjs";
import { requireGitMutationApproval } from "./git-mutation-approval.mjs";
import { resolveGitToplevel } from "./git-repo-probe.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
function buildOsGitCheckoutTool(options) {
  return {
    name: "os.git.checkout",
    description: "Switch to a branch, or create one and switch to it. Args: `branch` (required), `create` (default false \u2014 create the branch first), `startPoint` (commit-ish the new branch starts from; default HEAD), `repo` (optional path). May require approval.",
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
      const branch = requireBranchName(rawArgs.branch, "os.git.checkout");
      const create = rawArgs.create === true;
      const startPoint = typeof rawArgs.startPoint === "string" && rawArgs.startPoint.trim() ? requireRevision(rawArgs.startPoint, "os.git.checkout", "startPoint") : void 0;
      if (startPoint && !create) {
        throw new Error(
          "os.git.checkout: `startPoint` only makes sense with `create: true`"
        );
      }
      const args = create ? ["checkout", "-b", branch, ...startPoint ? [startPoint] : []] : ["checkout", branch];
      const toplevel = await resolveGitToplevel({
        repo,
        workingDir: ctx.workingDir,
        signal: ctx.signal
      });
      if (!toplevel.ok)
        return buildGitErrorResult(
          "os.git.checkout",
          `os.git.checkout: ${toplevel.message}`
        );
      await requireGitMutationApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: "os.git.checkout",
          repoRoot: toplevel.root,
          reason: create ? `create branch ${branch}${startPoint ? ` from ${startPoint}` : ""} and switch to it in ${toplevel.root}` : `switch to branch ${branch} in ${toplevel.root}`,
          preview: `git ${args.join(" ")}`,
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      const result = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args,
        signal: ctx.signal
      });
      if (result.timedOut) requireGitSuccess("os.git.checkout", result);
      if (result.exitCode !== 0) {
        return buildGitErrorResult(
          "os.git.checkout",
          describeGitFailure(result),
          { branch, created: create, repoRoot: result.repoRoot }
        );
      }
      const output = result.stderr.trim() || result.stdout.trim() || `switched to ${branch}`;
      return compressToolResult({
        tool: "os.git.checkout",
        status: "ok",
        output,
        details: {
          branch,
          created: create,
          startPoint: startPoint ?? null,
          repoRoot: result.repoRoot
        }
      });
    }
  };
}
function requireBranchName(raw, tool) {
  return requireRevision(raw, tool, "branch");
}
function requireRevision(raw, tool, field) {
  const branch = checkRef(raw, tool, field);
  return branch;
}
function checkRef(raw, tool, field) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${tool}: \`${field}\` must be a non-empty string`);
  }
  const branch = raw.trim();
  if (branch.startsWith("-")) {
    throw new Error(`${tool}: \`${field}\` must not start with '-'`);
  }
  if (/\s/.test(branch)) {
    throw new Error(`${tool}: \`${field}\` must not contain whitespace`);
  }
  return branch;
}
export {
  buildOsGitCheckoutTool,
  requireBranchName,
  requireRevision
};
