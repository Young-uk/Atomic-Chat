import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import { ENV_DEFAULTS } from "../../../config/config-schema.mjs";
import {
  formatShellTimeoutNotice
} from "./shell-timeout.mjs";
const GOG_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const GOG_COMPRESS_OPTIONS = {
  maxSummaryLength: 64e3,
  maxTailLines: 1e4
};
function shellCompressOptions(overflow) {
  const { shellToolResultCharCap, shellToolResultTailLines } = personalShellResultOptions;
  return {
    maxSummaryLength: shellToolResultCharCap,
    maxTailLines: shellToolResultTailLines,
    overflow
  };
}
function renderShellResult(input) {
  const { facts } = input;
  const header = `$ ${facts.commandLine}${facts.noArguments ? " (ran with no arguments)" : ""}
${input.statusLine}`;
  const output = [...input.notices, header, input.body].filter((part) => part.length > 0).join("\n");
  return compressToolResult(
    {
      tool: "os.shell.run",
      status: input.status,
      output,
      details: {
        cmd: facts.cmd,
        args: facts.args,
        rawArgs: facts.rawArgs,
        cwd: facts.cwd,
        shell: facts.shell,
        ...input.details,
        guardVerdict: facts.guard.action,
        guardRule: facts.guard.rule,
        guardReason: facts.guard.reason
      }
    },
    facts.gog ? GOG_COMPRESS_OPTIONS : shellCompressOptions(input.overflow ?? "tail")
  );
}
function joinShellOutput(output) {
  return [output.stdout, output.stderr].filter((s) => s.trim().length > 0).join("\n---\n");
}
function tailShellOutput(text, count) {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length <= count) return lines.join("\n");
  return `\u2026 [${lines.length - count} earlier lines]
${lines.slice(-count).join("\n")}`;
}
function formatExitStatus(exit) {
  return `${exit.exitCode ?? "signal:" + exit.signal}`;
}
function renderShellExit(facts, exit, output, extra = {}) {
  return renderShellResult({
    facts,
    status: exit.exitCode === 0 ? "ok" : "error",
    notices: extra.notices ?? [],
    statusLine: `exit: ${formatExitStatus(exit)}`,
    body: joinShellOutput(output),
    details: {
      exitCode: exit.exitCode,
      signal: exit.signal,
      durationMs: exit.durationMs,
      timedOut: false,
      ...extra.jobId === void 0 ? {} : { jobId: extra.jobId },
      truncated: output.truncated
    }
  });
}
function renderShellTimedOut(facts, exit, output, timeout, notices = []) {
  return renderShellResult({
    facts,
    status: "error",
    notices: [...notices, formatShellTimeoutNotice(timeout)],
    statusLine: `exit: ${formatExitStatus(exit)} (timed out)`,
    body: joinShellOutput(output),
    details: {
      exitCode: exit.exitCode,
      signal: exit.signal,
      durationMs: exit.durationMs,
      timedOut: true,
      timeoutMs: timeout.timeoutMs,
      source: timeout.source,
      truncated: output.truncated
    }
  });
}
let personalShellResultOptions = { shellToolResultCharCap: ENV_DEFAULTS.SHELL_TOOL_RESULT_CHAR_CAP, shellToolResultTailLines: ENV_DEFAULTS.SHELL_TOOL_RESULT_TAIL_LINES };
function configurePersonalShellResultOptions(options) {
  if (!Number.isInteger(options.shellToolResultCharCap) || options.shellToolResultCharCap < 400 || options.shellToolResultCharCap > 1e6 || !Number.isInteger(options.shellToolResultTailLines) || options.shellToolResultTailLines < 12 || options.shellToolResultTailLines > 1e5) throw new Error("Invalid Personal shell result limits");
  personalShellResultOptions = { ...options };
}
export {
  GOG_MAX_OUTPUT_BYTES,
  configurePersonalShellResultOptions,
  formatExitStatus,
  joinShellOutput,
  renderShellExit,
  renderShellResult,
  renderShellTimedOut,
  tailShellOutput
};
