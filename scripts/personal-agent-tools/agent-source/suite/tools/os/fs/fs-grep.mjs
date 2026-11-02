import { OS_FS_GREP_CONTRACT } from "./fs-grep-contract.mjs";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { runCommand as defaultRunCommand } from "../../../sandbox/command-runner.mjs";
import {
  resolveRipgrepPath,
  RIPGREP_MISSING_HINT
} from "../../../runtime/ripgrep-resolver.mjs";
import {
  buildRgArgs,
  parseArgs,
  resolveSearchTarget
} from "./fs-grep-args.mjs";
import { formatGrepResult } from "./fs-grep-format.mjs";
import { parseRipgrepJson } from "./fs-grep-ripgrep-json.mjs";
import { withTimeoutNote } from "./fs-grep-timeout.mjs";
import { isMissingPathError, missingPathResult } from "./fs-missing-path.mjs";
import { parseRipgrepJson as parseRipgrepJson2 } from "./fs-grep-ripgrep-json.mjs";
const REGEX_PARSE_ERROR = /regex parse error/i;
const LITERAL_HINT = "the pattern was parsed as a regex; to search for it as a fixed string, set `literal: true`";
function buildOsFsGrepTool(deps = {}) {
  const resolveRgPath = deps.resolveRgPath ?? (() => resolveRipgrepPath());
  const runCommand = deps.runCommand ?? defaultRunCommand;
  return {
    name: OS_FS_GREP_CONTRACT.name,
    description: OS_FS_GREP_CONTRACT.description,
    readonly: OS_FS_GREP_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const args = parseArgs(rawArgs, ctx.workingDir);
      const rgPath = resolveRgPath();
      if (!rgPath) {
        return compressToolResult({
          tool: "os.fs.grep",
          status: "error",
          output: RIPGREP_MISSING_HINT,
          details: { missing: true, hint: RIPGREP_MISSING_HINT }
        });
      }
      let target;
      try {
        target = await resolveSearchTarget(args.path, ctx.workingDir);
      } catch (err) {
        if (isMissingPathError(err)) {
          return missingPathResult(
            "os.fs.grep",
            args.path,
            ctx,
            err.code
          );
        }
        const reason = err.message;
        return compressToolResult({
          tool: "os.fs.grep",
          status: "error",
          output: reason,
          details: { path: args.path, hint: reason }
        });
      }
      const rgArgs = buildRgArgs(args, target.searchTarget);
      ctx.signal.throwIfAborted();
      const result = await runCommand(rgPath, rgArgs, {
        cwd: target.cwd,
        timeoutMs: args.timeoutMs,
        signal: ctx.signal
      });
      ctx.signal.throwIfAborted();
      if (result.timedOut) {
        const files2 = parseRipgrepJson(result.stdout);
        return withTimeoutNote(
          formatGrepResult(args, files2, rgPath, rgArgs, result),
          { elapsedMs: result.durationMs }
        );
      }
      if (result.exitCode === 1) {
        return compressToolResult({
          tool: "os.fs.grep",
          status: "ok",
          output: "(no matches)",
          details: {
            totals: { files: 0, matches: 0 },
            files: [],
            truncated: false,
            command: [rgPath, ...rgArgs],
            path: args.path
          }
        });
      }
      if (result.exitCode !== 0) {
        const stderr = result.stderr.trim();
        const reason = stderr.length > 0 ? stderr : `ripgrep exited with code ${result.exitCode}`;
        const hint = !args.literal && REGEX_PARSE_ERROR.test(stderr) ? LITERAL_HINT : null;
        return compressToolResult({
          tool: "os.fs.grep",
          status: "error",
          output: hint === null ? reason : `${reason}
hint: ${hint}`,
          details: {
            exitCode: result.exitCode,
            command: [rgPath, ...rgArgs],
            path: args.path,
            ...hint === null ? {} : { hint }
          }
        });
      }
      const files = parseRipgrepJson(result.stdout);
      return formatGrepResult(args, files, rgPath, rgArgs, result);
    }
  };
}
export {
  LITERAL_HINT,
  buildOsFsGrepTool,
  parseRipgrepJson2 as parseRipgrepJson
};
