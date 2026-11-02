import { realpath, stat } from "node:fs/promises";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { buildGitErrorResult, describeGitFailure } from "./git-error-result.mjs";
import {
  formatGitCommandLine,
  requireGitMutationApproval
} from "./git-mutation-approval.mjs";
import { resolveGitToplevel } from "./git-repo-probe.mjs";
import { runGit } from "./git-runner.mjs";
const TOOL = "os.git.init";
const DEFAULT_INITIAL_BRANCH = "main";
function buildOsGitInitTool(options) {
  return {
    name: TOOL,
    description: "Create a local git repository (`git init --initial-branch=<name|main>`) at `path` (default: working dir), optionally setting repo-local `userName` / `userEmail`. An existing repository is left as is. Requires approval like a file write in that directory.",
    readonly: false,
    async run(rawArgs, ctx) {
      const parsed = parseArgs(rawArgs, ctx.workingDir);
      if (!parsed.ok) return buildGitErrorResult(TOOL, parsed.message);
      const args = parsed.value;
      const existing = await probeExisting(args.target, ctx.workingDir, ctx.signal);
      if (!existing.ok) return buildGitErrorResult(TOOL, existing.message);
      const alreadyInitialised = existing.value.kind === "same";
      const commands = [];
      if (!alreadyInitialised) {
        commands.push([
          "init",
          `--initial-branch=${args.initialBranch}`,
          "--",
          args.target
        ]);
      }
      if (args.userName !== void 0) {
        commands.push(["config", "user.name", args.userName]);
      }
      if (args.userEmail !== void 0) {
        commands.push(["config", "user.email", args.userEmail]);
      }
      if (commands.length === 0) {
        return compressToolResult({
          tool: TOOL,
          status: "ok",
          output: formatOutput(args, existing.value),
          details: {
            repoRoot: args.target,
            initialBranch: null,
            alreadyInitialised: true,
            userName: null,
            userEmail: null,
            enclosingRepo: null
          }
        });
      }
      if (!alreadyInitialised) {
        const check = await runGit({
          workingDir: ctx.workingDir,
          args: ["check-ref-format", "--branch", args.initialBranch],
          signal: ctx.signal
        });
        if (check.exitCode !== 0) {
          return buildGitErrorResult(
            TOOL,
            `${TOOL}: invalid initial branch name '${args.initialBranch}': ${describeGitFailure(check)}`
          );
        }
      }
      await requireGitMutationApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: TOOL,
          repoRoot: args.target,
          reason: alreadyInitialised ? `git config identity in ${args.target}` : `git init in ${args.target}`,
          preview: commands.map(formatGitCommandLine).join("\n"),
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      for (const command of commands) {
        const result = await runGit({
          repo: command[0] === "init" ? void 0 : args.target,
          workingDir: ctx.workingDir,
          args: command,
          signal: ctx.signal
        });
        if (result.exitCode !== 0) {
          return buildGitErrorResult(TOOL, describeGitFailure(result), {
            repoRoot: args.target,
            alreadyInitialised
          });
        }
      }
      return compressToolResult({
        tool: TOOL,
        status: "ok",
        output: formatOutput(args, existing.value),
        details: {
          repoRoot: args.target,
          initialBranch: alreadyInitialised ? null : args.initialBranch,
          alreadyInitialised,
          userName: args.userName ?? null,
          userEmail: args.userEmail ?? null,
          enclosingRepo: existing.value.kind === "nested" ? existing.value.enclosingRoot : null
        }
      });
    }
  };
}
function parseArgs(rawArgs, workingDir) {
  const path = optionalString(rawArgs.path);
  const initialBranch = optionalString(rawArgs.initialBranch);
  const userName = optionalString(rawArgs.userName);
  const userEmail = optionalString(rawArgs.userEmail);
  for (const [field, value2] of [
    ["path", path],
    ["initialBranch", initialBranch],
    ["userName", userName],
    ["userEmail", userEmail]
  ]) {
    if (value2 === "") {
      return { ok: false, message: `${TOOL}: \`${field}\` must be a non-empty string` };
    }
  }
  if (initialBranch !== void 0 && initialBranch.startsWith("-")) {
    return { ok: false, message: `${TOOL}: \`initialBranch\` may not start with "-"` };
  }
  const value = {
    target: path !== void 0 ? resolveUserPath(path, workingDir) : workingDir,
    initialBranch: initialBranch ?? DEFAULT_INITIAL_BRANCH
  };
  if (userName !== void 0) value.userName = userName;
  if (userEmail !== void 0) value.userEmail = userEmail;
  return { ok: true, value };
}
function optionalString(raw) {
  if (raw === void 0 || raw === null) return void 0;
  return typeof raw === "string" ? raw.trim() : "";
}
async function probeExisting(target, workingDir, signal) {
  try {
    const info = await stat(target);
    if (!info.isDirectory()) {
      return { ok: false, message: `${TOOL}: ${target} exists and is not a directory` };
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: true, value: { kind: "none" } };
    }
    throw err;
  }
  const toplevel = await resolveGitToplevel({ repo: target, workingDir, signal });
  if (!toplevel.ok) return { ok: true, value: { kind: "none" } };
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(toplevel.root),
    realpath(target)
  ]);
  if (canonicalRoot === canonicalTarget) return { ok: true, value: { kind: "same" } };
  return { ok: true, value: { kind: "nested", enclosingRoot: toplevel.root } };
}
function formatOutput(args, existing) {
  const lines = [];
  if (existing.kind === "same") {
    lines.push(`${args.target} is already a git repository (not re-initialised)`);
  } else {
    lines.push(
      `initialised empty git repository at ${args.target} (initial branch ${args.initialBranch})`
    );
  }
  if (existing.kind === "nested") {
    lines.push(`note: nested inside the repository at ${existing.enclosingRoot}`);
  }
  if (args.userName !== void 0 || args.userEmail !== void 0) {
    const who = [args.userName, args.userEmail && `<${args.userEmail}>`].filter((part) => typeof part === "string").join(" ");
    lines.push(`repo-local identity: ${who}`);
  }
  return lines.join("\n");
}
export {
  buildOsGitInitTool
};
