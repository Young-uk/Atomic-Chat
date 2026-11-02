import { spawn } from "node:child_process";
import { killProcessTree } from "./kill-process-tree.mjs";
const IS_WINDOWS = process.platform === "win32";
const BROKEN_PIPE_CODES = /* @__PURE__ */ new Set([
  "EPIPE",
  "ECONNRESET",
  "EOF",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END"
]);
function isBrokenPipe(err) {
  const code = err?.code;
  return typeof code === "string" && BROKEN_PIPE_CODES.has(code);
}
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
async function runCommand(command, args, options) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 6e4;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
      // Prevent a console window flashing when the runtime is launched
      // from a GUI/TUI host on Windows.
      ...IS_WINDOWS ? { windowsHide: true } : {},
      ...options.windowsVerbatimArguments === void 0 ? {} : { windowsVerbatimArguments: options.windowsVerbatimArguments }
    });
    const chunks = { stdout: [], stderr: [] };
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let inputTruncated = false;
    let timedOut = false;
    let settled = false;
    const killIt = (reason) => {
      if (settled) return;
      timedOut = reason === "timeout";
      killProcessTree(child, { force: true });
    };
    const timer = timeoutMs > 0 && Number.isFinite(timeoutMs) ? setTimeout(() => killIt("timeout"), timeoutMs) : null;
    const onAbort = () => killIt("abort");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = () => {
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (chunk) => {
      if (stdoutBytes + chunk.length > maxOutputBytes) {
        const slice = chunk.slice(0, Math.max(0, maxOutputBytes - stdoutBytes));
        if (slice.length > 0) {
          chunks.stdout.push(slice);
          stdoutBytes += slice.length;
        }
        truncated = true;
        return;
      }
      chunks.stdout.push(chunk);
      stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes + chunk.length > maxOutputBytes) {
        const slice = chunk.slice(0, Math.max(0, maxOutputBytes - stderrBytes));
        if (slice.length > 0) {
          chunks.stderr.push(slice);
          stderrBytes += slice.length;
        }
        truncated = true;
        return;
      }
      chunks.stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    child.on("error", (err) => {
      if (settled) return;
      finish();
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      finish();
      resolve({
        command,
        args,
        exitCode: code,
        signal,
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
        inputTruncated
      });
    });
    child.stdin.on("error", (err) => {
      if (isBrokenPipe(err)) {
        inputTruncated = true;
        return;
      }
      if (settled) return;
      finish();
      reject(err);
    });
    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
export {
  DEFAULT_MAX_OUTPUT_BYTES,
  isBrokenPipe,
  runCommand
};
