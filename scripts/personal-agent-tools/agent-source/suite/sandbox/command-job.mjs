import { spawn } from "node:child_process";
import { CappedOutput } from "./capped-output.mjs";
import { killProcessTree } from "./kill-process-tree.mjs";
const IS_WINDOWS = process.platform === "win32";
const JOB_STOP_GRACE_MS = 2e3;
const DEFAULT_JOB_OUTPUT_BYTES = 1024 * 1024;
const JOB_EXIT_SETTLE_MS = JOB_STOP_GRACE_MS + 3e3;
async function awaitJobExit(job, maxWaitMs = JOB_EXIT_SETTLE_MS) {
  const known = job.exited();
  if (known) return known;
  await job.waitFor(maxWaitMs).catch(() => void 0);
  return job.exited() ?? {
    exitCode: null,
    signal: null,
    durationMs: Date.now() - job.startedAt
  };
}
function signalGroup(child, signal) {
  if (IS_WINDOWS) {
    killProcessTree(child, { force: signal === "SIGKILL" });
    return;
  }
  if (typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
    }
  }
  try {
    child.kill(signal);
  } catch {
  }
}
function startCommandJob(command, args, options) {
  const startedAt = Date.now();
  const cap = options.maxOutputBytes ?? DEFAULT_JOB_OUTPUT_BYTES;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    // A group of its own on POSIX; on Windows `detached` would open a
    // console, and the tree-kill needs no group.
    ...IS_WINDOWS ? { windowsHide: true } : { detached: true },
    ...options.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}
  });
  const stdout = new CappedOutput(cap);
  const stderr = new CappedOutput(cap);
  let exit = null;
  let spawnError = null;
  let stopTimer = null;
  const clearStop = () => {
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
  };
  const exitPromise = new Promise((resolve, reject) => {
    child.on("error", (err) => {
      if (exit || spawnError) return;
      spawnError = err;
      clearStop();
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (exit || spawnError) return;
      exit = {
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt
      };
      clearStop();
      resolve(exit);
    });
  });
  exitPromise.catch(() => void 0);
  child.stdout.on("data", (chunk) => stdout.append(chunk));
  child.stderr.on("data", (chunk) => stderr.append(chunk));
  child.stdin.on("error", () => void 0);
  child.stdin.end();
  return {
    command,
    args,
    pid: child.pid,
    startedAt,
    exit: exitPromise,
    exited: () => exit,
    output: () => {
      const out = stdout.snapshot();
      const err = stderr.snapshot();
      return {
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated
      };
    },
    waitFor(ms, signal) {
      if (spawnError) return Promise.reject(spawnError);
      if (exit) return Promise.resolve("exited");
      if (signal?.aborted) return Promise.resolve("aborted");
      return new Promise((resolve, reject) => {
        const timer = ms > 0 && Number.isFinite(ms) ? setTimeout(() => settle("elapsed"), ms) : null;
        const onAbort = () => settle("aborted");
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };
        const settle = (outcome) => {
          cleanup();
          resolve(outcome);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        exitPromise.then(
          () => settle("exited"),
          (err) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        );
      });
    },
    stop() {
      if (exit || spawnError || stopTimer) return;
      signalGroup(child, "SIGTERM");
      stopTimer = setTimeout(() => signalGroup(child, "SIGKILL"), JOB_STOP_GRACE_MS);
    },
    kill() {
      if (exit || spawnError) return;
      clearStop();
      signalGroup(child, "SIGKILL");
    }
  };
}
export {
  DEFAULT_JOB_OUTPUT_BYTES,
  JOB_EXIT_SETTLE_MS,
  JOB_STOP_GRACE_MS,
  awaitJobExit,
  startCommandJob
};
