import { spawn } from "node:child_process";
import { buildCommandEnv } from "../../sandbox/command-env.mjs";
import { killProcessTree } from "../../sandbox/kill-process-tree.mjs";
import {
  buildDirectInvocation,
  buildSubshellInvocation
} from "../../sandbox/shell-invocation.mjs";
import { needsShellInterpretation } from "../os/shell/shell.mjs";
const OUTPUT_TAIL_CHARS = 8e3;
const OUTPUT_KEEP_CHARS = 1024 * 1024;
class TailBuffer {
  text = "";
  dropped = false;
  append(chunk) {
    this.text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (this.text.length > OUTPUT_KEEP_CHARS) {
      this.text = this.text.slice(-OUTPUT_KEEP_CHARS);
      this.dropped = true;
    }
  }
  /** Everything kept (up to 1 MB, head dropped first). */
  all() {
    return this.text;
  }
  /** The last 8,000 chars — tail first, that is where the failure is. */
  tail() {
    const clipped = this.text.length > OUTPUT_TAIL_CHARS || this.dropped;
    const tail = this.text.slice(-OUTPUT_TAIL_CHARS);
    return clipped ? `\u2026${tail}` : tail;
  }
}
const NETWORK_BLOCK_PROXY = "http://127.0.0.1:9";
function networkBlockEnv() {
  return {
    HTTP_PROXY: NETWORK_BLOCK_PROXY,
    HTTPS_PROXY: NETWORK_BLOCK_PROXY,
    ALL_PROXY: NETWORK_BLOCK_PROXY,
    http_proxy: NETWORK_BLOCK_PROXY,
    https_proxy: NETWORK_BLOCK_PROXY,
    all_proxy: NETWORK_BLOCK_PROXY,
    NO_PROXY: "",
    no_proxy: ""
  };
}
function resolveInvocation(cmd, args) {
  const commandLine = [cmd, ...args].join(" ");
  const invocation = needsShellInterpretation(cmd, args) ? buildSubshellInvocation(commandLine) : buildDirectInvocation(cmd, args);
  return { ...invocation, commandLine };
}
function spawnVerifyProcess(cmd, args, options) {
  const invocation = resolveInvocation(cmd, args);
  const detached = process.platform !== "win32";
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: {
      ...buildCommandEnv(process.env),
      ...options.network ? {} : networkBlockEnv(),
      ...options.env ?? {}
    },
    detached,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}
  });
  const stdout = new TailBuffer();
  const stderr = new TailBuffer();
  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));
  let killed = false;
  let timedOut = false;
  let aborted = false;
  const killGroup = () => {
    if (killed) return;
    killed = true;
    if (detached && typeof child.pid === "number") {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
      }
    }
    killProcessTree(child, { force: true });
  };
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, options.timeoutMs);
  const onAbort = () => {
    aborted = true;
    killGroup();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const exited = new Promise((resolve) => {
    let settled = false;
    const finish = (exit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      killGroup();
      resolve(exit);
    };
    child.on("error", (err) => {
      finish({ exitCode: null, signal: null, timedOut, aborted, spawnError: err.message });
    });
    child.on("close", (code, signal) => {
      finish({ exitCode: code, signal, timedOut, aborted });
    });
  });
  return { child, commandLine: invocation.commandLine, stdout, stderr, exited, killGroup };
}
export {
  NETWORK_BLOCK_PROXY,
  OUTPUT_TAIL_CHARS,
  TailBuffer,
  networkBlockEnv,
  resolveInvocation,
  spawnVerifyProcess
};
