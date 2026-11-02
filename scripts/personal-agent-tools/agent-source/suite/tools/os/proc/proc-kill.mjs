import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { runCommand } from "../../../sandbox/command-runner.mjs";
import {
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
const SUPPORTED_SIGNALS = [
  "SIGTERM",
  "SIGKILL",
  "SIGINT",
  "SIGHUP"
];
function buildOsProcKillTool(options) {
  return {
    name: "os.proc.kill",
    description: "Send a signal to a process by PID. Dangerous \u2014 always requires approval. Args: `pid` (required), `signal` (SIGTERM|SIGKILL|SIGINT|SIGHUP, default SIGTERM).",
    readonly: false,
    async run(rawArgs, ctx) {
      const args = parseArgs(rawArgs);
      const preview = await describeTarget(args.pid, ctx.signal);
      await requireApproval(
        options,
        {
          sessionId: ctx.sessionId,
          tool: "os.proc.kill",
          category: "proc_kill",
          reason: `send ${args.signal} to pid ${args.pid}`,
          preview,
          affectedResources: [`pid:${args.pid}`]
        },
        ctx.signal
      );
      const sent = await sendSignal(args.pid, args.signal);
      return compressToolResult({
        tool: "os.proc.kill",
        status: sent.ok ? "ok" : "error",
        output: sent.ok ? `sent ${args.signal} to pid ${args.pid}` : `failed to send ${args.signal} to pid ${args.pid}: ${sent.error}`,
        details: {
          pid: args.pid,
          signal: args.signal,
          success: sent.ok,
          error: sent.error ?? null,
          preview
        }
      });
    }
  };
}
function parseArgs(raw) {
  if (typeof raw.pid !== "number" || !Number.isFinite(raw.pid) || raw.pid <= 0) {
    throw new Error("os.proc.kill: `pid` must be a positive number");
  }
  const pid = Math.floor(raw.pid);
  let signal = "SIGTERM";
  if (raw.signal !== void 0 && raw.signal !== null) {
    if (typeof raw.signal !== "string") {
      throw new Error("os.proc.kill: `signal` must be a string");
    }
    const upper = raw.signal.toUpperCase();
    if (!SUPPORTED_SIGNALS.includes(upper)) {
      throw new Error(
        `os.proc.kill: unsupported signal ${JSON.stringify(raw.signal)} (supported: ${SUPPORTED_SIGNALS.join(", ")})`
      );
    }
    signal = upper;
  }
  return { pid, signal };
}
async function describeTarget(pid, signal) {
  try {
    if (process.platform === "win32") {
      const res2 = await runCommand(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { cwd: process.cwd(), signal, timeoutMs: 5e3 }
      );
      const line2 = res2.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
      return line2 ? `target: ${line2}` : `target pid ${pid} not found`;
    }
    const res = await runCommand(
      "ps",
      ["-o", "pid=,user=,comm=", "-p", String(pid)],
      { cwd: process.cwd(), signal, timeoutMs: 5e3 }
    );
    const line = res.stdout.trim();
    return line ? `target: ${line}` : `target pid ${pid} not found`;
  } catch (err) {
    return `(could not resolve target: ${err.message})`;
  }
}
async function sendSignal(pid, signal) {
  if (process.platform === "win32") {
    const force = signal === "SIGKILL";
    const taskkillArgs = force ? ["/PID", String(pid), "/F"] : ["/PID", String(pid)];
    try {
      const res = await runCommand("taskkill", taskkillArgs, {
        cwd: process.cwd(),
        timeoutMs: 5e3
      });
      if (res.exitCode === 0) return { ok: true, error: null };
      return {
        ok: false,
        error: res.stderr.trim() || `taskkill exited with ${res.exitCode}`
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  try {
    process.kill(pid, signal);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
export {
  buildOsProcKillTool
};
