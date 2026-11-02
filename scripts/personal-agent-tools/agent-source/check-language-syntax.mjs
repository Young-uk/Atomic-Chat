import { runChecker } from "./check-script-syntax.mjs";
import { tailOfOutput } from "./syntax-check-types.mjs";
const CHECKERS = {
  ".go": { tool: "gofmt", cmd: "gofmt", args: ["-l", "-e"] },
  ".rb": { tool: "ruby", cmd: "ruby", args: ["-c"] },
  ".php": { tool: "php", cmd: "php", args: ["-l"] },
  ".lua": { tool: "luac", cmd: "luac", args: ["-p"] },
  ".zsh": { tool: "zsh", cmd: "zsh", args: ["-n"] }
};
const LANGUAGE_SYNTAX_EXTENSIONS = new Set(
  Object.keys(CHECKERS)
);
async function checkLanguageFile(file, ext, options = {}) {
  const spec = CHECKERS[ext];
  if (spec === void 0) {
    return { file, ok: null, checker: "none", error: `no checker for ${ext}` };
  }
  const cmd = options.cmd ?? spec.cmd;
  const run = await runChecker(cmd, [...spec.args, file]);
  const checker = `${spec.cmd} ${spec.args.join(" ")}`;
  if (run.missing) {
    return { file, ok: null, checker: "none", error: `${spec.tool} not found` };
  }
  if (run.timedOut) return { file, ok: null, checker, error: "timed out" };
  if (run.exitCode === 0) return { file, ok: true, checker };
  return {
    file,
    ok: false,
    checker,
    // php -l reports on stdout, the others on stderr.
    error: tailOfOutput(`${run.stdout}
${run.stderr}`, 4) || `exit ${run.exitCode}`
  };
}
export {
  LANGUAGE_SYNTAX_EXTENSIONS,
  checkLanguageFile
};
