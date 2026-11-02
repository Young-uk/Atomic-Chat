import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { hasEmbeddedUserinfo } from "./git-credentials.mjs";
import {
  gitFailureResult,
  optionalString,
  refuseWhenRemoteSyncOff,
  requireGitRemoteApproval
} from "./git-remote-policy.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
const TOOL = "os.git.remote";
function buildOsGitRemoteTool(options) {
  return {
    name: TOOL,
    description: 'Manage remotes. `action`: "list" (default, read-only), "add" {name, url}, "set-url" {name, url}, "remove" {name}. Adding or re-pointing a remote needs Remote sync on and asks for approval; URLs with embedded credentials are refused.',
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = optionalString(rawArgs.repo);
      const action = parseAction(rawArgs.action);
      if (action === null) {
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: \`action\` must be one of list, add, remove, set-url`,
          details: { action: rawArgs.action ?? null }
        });
      }
      if (action === "list") return listRemotes(repo, ctx);
      const name = optionalString(rawArgs.name);
      if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
        return compressToolResult({
          tool: TOOL,
          status: "error",
          output: `${TOOL}: \`name\` must be a plain remote name (letters, digits, . _ -)`,
          details: { action, name: name ?? null }
        });
      }
      const url = action === "remove" ? void 0 : optionalString(rawArgs.url);
      if (action !== "remove") {
        if (!url) {
          return compressToolResult({
            tool: TOOL,
            status: "error",
            output: `${TOOL}: \`url\` is required for ${action}`,
            details: { action, name }
          });
        }
        if (hasEmbeddedUserinfo(url)) {
          return compressToolResult({
            tool: TOOL,
            status: "error",
            output: `${TOOL}: refusing a URL with embedded credentials \u2014 it would be written to .git/config. Use a plain https://github.com/... URL; the token from Integrations \u2192 GitHub is supplied at push time.`,
            details: { action, name, refused: true }
          });
        }
        const refused = refuseWhenRemoteSyncOff(TOOL, options, { action, name });
        if (refused) return refused;
      }
      const gitArgs = action === "add" ? ["remote", "add", name, url] : action === "set-url" ? ["remote", "set-url", name, url] : ["remote", "remove", name];
      const preview = `git ${gitArgs.join(" ")}`;
      const probe = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["rev-parse", "--show-toplevel"],
        signal: ctx.signal,
        timeoutMs: 5e3
      });
      requireGitSuccess(TOOL, probe);
      const repoRoot = probe.stdout.trim();
      await requireGitRemoteApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          reason: `${action} remote ${name} in ${repoRoot}`,
          preview,
          affectedResources: [repoRoot]
        },
        ctx.signal
      );
      const result = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: gitArgs,
        signal: ctx.signal,
        timeoutMs: 1e4
      });
      if (result.exitCode !== 0) {
        return gitFailureResult(TOOL, result, { action, name, repoRoot });
      }
      const remotes = await readRemotes(repo, ctx);
      return compressToolResult({
        tool: TOOL,
        status: "ok",
        output: `${preview}
${formatRemotes(remotes)}`,
        details: { action, name, url: url ?? null, remotes, repoRoot }
      });
    }
  };
}
function parseAction(raw) {
  if (raw === void 0 || raw === null || raw === "") return "list";
  if (raw === "list" || raw === "add" || raw === "remove" || raw === "set-url") {
    return raw;
  }
  return null;
}
async function listRemotes(repo, ctx) {
  const remotes = await readRemotes(repo, ctx);
  return compressToolResult({
    tool: TOOL,
    status: "ok",
    output: formatRemotes(remotes),
    details: { action: "list", remotes, count: remotes.length }
  });
}
async function readRemotes(repo, ctx) {
  const result = await runGit({
    repo,
    workingDir: ctx.workingDir,
    args: ["remote", "-v"],
    signal: ctx.signal,
    timeoutMs: 5e3
  });
  requireGitSuccess(TOOL, result);
  const byName = /* @__PURE__ */ new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const name = match[1];
    const url = match[2];
    const kind = match[3];
    const entry = byName.get(name) ?? { name, fetchUrl: "", pushUrl: "" };
    if (kind === "fetch") entry.fetchUrl = url;
    else entry.pushUrl = url;
    byName.set(name, entry);
  }
  return [...byName.values()];
}
function formatRemotes(remotes) {
  if (remotes.length === 0) return "(no remotes \u2014 this repository is local-only)";
  return remotes.map(
    (r) => r.fetchUrl === r.pushUrl ? `${r.name}	${r.fetchUrl}` : `${r.name}	${r.fetchUrl} (fetch)
${r.name}	${r.pushUrl} (push)`
  ).join("\n");
}
export {
  buildOsGitRemoteTool
};
