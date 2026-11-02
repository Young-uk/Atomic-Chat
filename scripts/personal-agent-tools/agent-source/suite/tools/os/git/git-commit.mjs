import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { buildGitErrorResult } from "./git-error-result.mjs";
import {
  formatGitCommandLine,
  requireGitMutationApproval
} from "./git-mutation-approval.mjs";
import { resolveGitToplevel } from "./git-repo-probe.mjs";
import { requireGitSuccess, runGit } from "./git-runner.mjs";
function buildOsGitCommitTool(options) {
  return {
    name: "os.git.commit",
    description: "Stage and commit. Args: `message` (required), `paths` (stage these paths first), `all` (stage every change incl. untracked; default false), `repo` (optional path). With neither `paths` nor `all` only what is already staged is committed. May require approval.",
    readonly: false,
    async run(rawArgs, ctx) {
      const repo = typeof rawArgs.repo === "string" ? rawArgs.repo : void 0;
      const message = parseMessage(rawArgs.message);
      const paths = parsePaths(rawArgs.paths);
      const all = rawArgs.all === true;
      if (all && paths.length > 0) {
        throw new Error(
          "os.git.commit: pass either `paths` or `all`, not both"
        );
      }
      const probe = { repo, workingDir: ctx.workingDir, signal: ctx.signal };
      const toplevel = await resolveGitToplevel(probe);
      if (!toplevel.ok)
        return buildGitErrorResult(
          "os.git.commit",
          `os.git.commit: ${toplevel.message}`
        );
      const staging = await describeStaging(repo, ctx, paths, all);
      const commandLine = formatGitCommandLine(commitArgs(message));
      const preview = `${commandLine}

${staging}`;
      await requireGitMutationApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: "os.git.commit",
          repoRoot: toplevel.root,
          reason: `commit "${firstLine(message)}" in ${toplevel.root}`,
          preview,
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      if (all) {
        const add = await runGit({
          repo,
          workingDir: ctx.workingDir,
          args: ["add", "-A"],
          signal: ctx.signal
        });
        requireGitSuccess("os.git.commit", add);
      } else if (paths.length > 0) {
        const add = await runGit({
          repo,
          workingDir: ctx.workingDir,
          args: ["add", "--", ...paths],
          signal: ctx.signal
        });
        requireGitSuccess("os.git.commit", add);
      }
      const commit = await runGit({
        repo,
        workingDir: ctx.workingDir,
        // `-c commit.gpgsign=false` goes before the subcommand so it
        // beats any repo or global setting: a signing prompt has no
        // terminal to appear on here, and the commit would hang until
        // the turn's timeout with nothing to show for it.
        args: commitArgs(message),
        signal: ctx.signal,
        timeoutMs: 3e4
      });
      if (commit.exitCode !== 0 && /nothing to commit/i.test(commit.stdout + commit.stderr)) {
        throw new Error(
          "os.git.commit: nothing to commit \u2014 stage changes with `paths` or `all: true`"
        );
      }
      requireGitSuccess("os.git.commit", commit);
      const head = await runGit({
        repo,
        workingDir: ctx.workingDir,
        args: ["rev-parse", "--short", "HEAD"],
        signal: ctx.signal,
        timeoutMs: 5e3
      });
      const hash = head.exitCode === 0 ? head.stdout.trim() : null;
      return compressToolResult({
        tool: "os.git.commit",
        status: "ok",
        output: commit.stdout.trim() || `committed ${hash ?? ""}`.trim(),
        details: {
          hash,
          message,
          stagedAll: all,
          paths,
          repoRoot: commit.repoRoot
        }
      });
    }
  };
}
function parseMessage(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("os.git.commit: `message` must be a non-empty string");
  }
  return raw.trim();
}
function parsePaths(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((p) => typeof p === "string")) {
    throw new Error("os.git.commit: `paths` must be an array of strings");
  }
  const paths = raw.map((p) => p.trim()).filter((p) => p.length > 0);
  for (const p of paths) {
    if (p.startsWith("-")) {
      throw new Error(
        `os.git.commit: path ${JSON.stringify(p)} must not start with '-'`
      );
    }
  }
  return paths;
}
function firstLine(message) {
  const line = message.split(/\r?\n/, 1)[0] ?? message;
  return line.length > 72 ? `${line.slice(0, 69)}\u2026` : line;
}
function commitArgs(message) {
  return ["-c", "commit.gpgsign=false", "commit", "-m", message];
}
async function describeStaging(repo, ctx, paths, all) {
  try {
    const args = ["status", "--short"];
    if (!all && paths.length > 0) args.push("--", ...paths);
    const status = await runGit({
      repo,
      workingDir: ctx.workingDir,
      args,
      signal: ctx.signal,
      timeoutMs: 1e4
    });
    if (status.exitCode !== 0) return "(could not read git status)";
    const lines = status.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const scope = all ? "staging every change" : paths.length > 0 ? `staging ${paths.length} path${paths.length === 1 ? "" : "s"}` : "committing what is already staged";
    const shown = all || paths.length > 0 ? lines : lines.filter((l) => l[0] !== " " && l[0] !== "?");
    const head = shown.slice(0, 40);
    const more = shown.length > head.length ? `
\u2026 ${shown.length - head.length} more` : "";
    return `${scope}
${head.join("\n") || "(no changes)"}${more}`;
  } catch (err) {
    return `(could not read git status: ${err.message})`;
  }
}
export {
  buildOsGitCommitTool
};
