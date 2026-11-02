import { stat } from "node:fs/promises";
import {
  runCommand
} from "../../../sandbox/command-runner.mjs";
import { buildCommandEnv } from "../../../sandbox/command-env.mjs";
import { resolveUserPath } from "../expand-home.mjs";
const DEFAULT_TIMEOUT_MS = 15e3;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
async function runGit(options) {
  const repoRoot = await resolveRepoRoot(options.repo, options.workingDir);
  const env = {
    ...buildCommandEnv(process.env),
    ...options.env,
    GIT_PAGER: "",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C"
  };
  let result;
  try {
    result = await runCommand("git", ["--no-pager", ...options.args], {
      cwd: repoRoot,
      env,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      signal: options.signal
    });
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(
        "os.git: git was not found on PATH. Install Git and ensure it is on PATH."
      );
    }
    throw err;
  }
  return { ...result, repoRoot };
}
async function resolveRepoRoot(explicit, workingDir) {
  const candidate = explicit ? resolveUserPath(explicit, workingDir) : workingDir;
  try {
    const info = await stat(candidate);
    if (!info.isDirectory()) {
      throw new Error(`os.git: repo path ${candidate} is not a directory`);
    }
  } catch (err) {
    throw new Error(
      `os.git: cannot access repo ${candidate}: ${err.message}`
    );
  }
  return candidate;
}
function requireGitSuccess(tool, result) {
  if (result.timedOut) {
    throw new Error(`${tool}: git timed out after ${result.durationMs}ms`);
  }
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim() || "(no stderr)";
    throw new Error(
      `${tool}: git ${result.args.join(" ")} exited with ${result.exitCode}: ${stderr}`
    );
  }
}
export {
  requireGitSuccess,
  runGit
};
