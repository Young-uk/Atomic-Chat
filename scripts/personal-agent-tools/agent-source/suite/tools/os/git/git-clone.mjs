import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { hasEmbeddedUserinfo } from "./git-credentials.mjs";
import {
  CLONE_REPORT_LIMITS,
  NO_PROGRESS,
  shapeCloneReport
} from "./git-remote-report.mjs";
import {
  gitFailureResult,
  optionalString,
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval,
  runGitRemote
} from "./git-remote-policy.mjs";
const TOOL = "os.git.clone";
const CLONE_TIMEOUT_MS = 3e5;
function buildOsGitCloneTool(options) {
  return {
    name: TOOL,
    description: "Clone a repository. `url` required; `dest` defaults to the repo name under the working directory; optional `branch`, `depth`. Needs Remote sync on; asks for approval. URLs with embedded credentials are refused.",
    readonly: false,
    async run(rawArgs, ctx) {
      const url = optionalString(rawArgs.url);
      if (!url) {
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: \`url\` is required`,
          details: {}
        });
      }
      if (hasEmbeddedUserinfo(url)) {
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: refusing a URL with embedded credentials \u2014 it would be written to .git/config. Use a plain URL; the token from Integrations \u2192 GitHub is supplied at clone time.`,
          details: { refused: true }
        });
      }
      const refused = refuseWhenRemoteSyncOff(TOOL, options, { url });
      if (refused) return refused;
      const destArg = optionalString(rawArgs.dest);
      const dest = destArg ? resolveUserPath(destArg, ctx.workingDir) : resolve(ctx.workingDir, repoNameFromUrl(url));
      const parent = dirname(dest);
      try {
        await stat(dest);
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: destination ${dest} already exists`,
          details: { url, dest }
        });
      } catch {
      }
      try {
        if (!(await stat(parent)).isDirectory()) throw new Error("not a directory");
      } catch {
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: parent folder ${parent} does not exist \u2014 create it first or pick another dest`,
          details: { url, dest, parent }
        });
      }
      const branch = optionalString(rawArgs.branch);
      const depth = typeof rawArgs.depth === "number" && Number.isInteger(rawArgs.depth) && rawArgs.depth > 0 ? rawArgs.depth : void 0;
      const args = ["clone", NO_PROGRESS];
      if (branch) args.push("--branch", branch);
      if (depth !== void 0) args.push("--depth", String(depth));
      args.push("--", url, dest);
      const preview = `git ${args.join(" ")}`;
      await requireGitRemoteApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          reason: `clone ${url} into ${dest}`,
          preview,
          affectedResources: [dest]
        },
        ctx.signal
      );
      const result = await runGitRemote(options, {
        repo: parent,
        workingDir: ctx.workingDir,
        args,
        signal: ctx.signal,
        timeoutMs: CLONE_TIMEOUT_MS
      });
      if (result.exitCode !== 0) {
        return gitFailureResult(TOOL, result, { url, dest });
      }
      return compressToolResult(
        {
          tool: TOOL,
          status: "ok",
          output: `${preview}
${shapeCloneReport(result.stderr)}`,
          details: { url, dest, branch: branch ?? null, depth: depth ?? null }
        },
        CLONE_REPORT_LIMITS
      );
    }
  };
}
function repoNameFromUrl(url) {
  const cleaned = url.replace(/[/\\]+$/, "");
  const last = basename(cleaned.replace(/:([^/]+)$/, "/$1"));
  return last.replace(/\.git$/i, "") || "repo";
}
export {
  buildOsGitCloneTool,
  repoNameFromUrl
};
