import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { isSeaBuild } from "../../runtime/self-invocation.mjs";
import { checkFileParses } from "../os/fs/fs-parse-check.mjs";
import { tailOfOutput } from "./syntax-check-types.mjs";
const CHECKER_TIMEOUT_MS = 6e4;
const CHECKER_OUTPUT_CAP = 64 * 1024;
function isMissingBinary(err) {
  return err?.code === "ENOENT";
}
function runChecker(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value === void 0) delete env[key];
      else env[key] = value;
    }
    const child = spawn(cmd, [...args], {
      ...options.cwd === void 0 ? {} : { cwd: options.cwd },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }, options.timeoutMs ?? CHECKER_TIMEOUT_MS);
    const finish = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    child.stdout.on("data", (chunk) => {
      if (stdout.length < CHECKER_OUTPUT_CAP) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < CHECKER_OUTPUT_CAP) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      finish({
        exitCode: null,
        stdout,
        stderr: stderr.length > 0 ? stderr : String(err),
        missing: isMissingBinary(err),
        timedOut
      });
    });
    child.on("close", (code) => {
      finish({ exitCode: code, stdout, stderr, missing: false, timedOut });
    });
  });
}
function describeNodeCheckFailure(run) {
  const text = run.stderr.replace(/\r\n/g, "\n");
  const line = text.match(/^[^\n]*:(\d+)\n/)?.[1];
  const error = text.match(/^(\w*Error: [^\n]*)$/m)?.[1];
  if (error === void 0) return tailOfOutput(text, 4);
  return line === void 0 ? error : `${error} (line ${line})`;
}
function nodeForSyntaxCheck(sea = isSeaBuild(), execPath = process.execPath) {
  return sea ? "node" : execPath;
}
const NO_NODE_FOR_CHECK = "no Node.js found on PATH to run node --check (release builds cannot use their own binary for it)";
async function nodeCheck(file, pathToCheck, node = nodeForSyntaxCheck()) {
  const run = await runChecker(node, ["--check", pathToCheck]);
  if (run.missing) {
    return { file, ok: null, checker: "none", error: NO_NODE_FOR_CHECK };
  }
  if (run.timedOut) {
    return { file, ok: null, checker: "node --check", error: "timed out" };
  }
  if (run.exitCode === 0) return { file, ok: true, checker: "node --check" };
  if (!/\bSyntaxError\b/.test(run.stderr)) {
    return {
      file,
      ok: null,
      checker: "node --check",
      error: `node --check did not run: ${tailOfOutput(`${run.stderr}
${run.stdout}`, 2) || `exit ${run.exitCode}`}`
    };
  }
  return {
    file,
    ok: false,
    checker: "node --check",
    error: describeNodeCheckFailure(run)
  };
}
async function checkJavaScriptFile(file, content) {
  const parsed = checkFileParses(file, content);
  if (parsed.kind === "ok") return { file, ok: true, checker: "node-vm" };
  if (parsed.kind === "error") {
    return { file, ok: false, checker: "node-vm", error: parsed.message };
  }
  if (extname(file).toLowerCase() === ".json") {
    return {
      file,
      ok: null,
      checker: "none",
      error: "too large to parse in-process"
    };
  }
  return nodeCheck(file, file);
}
async function checkJavaScriptSource(label, code, options) {
  const pseudo = `${label}${options.module ? ".mjs" : ".js"}`;
  const parsed = checkFileParses(pseudo, code);
  if (parsed.kind === "ok") return { file: label, ok: true, checker: "node-vm" };
  if (parsed.kind === "error") {
    return { file: label, ok: false, checker: "node-vm", error: parsed.message };
  }
  const dir = await mkdtemp(join(tmpdir(), "atag-verify-inline-"));
  try {
    const temp = join(dir, `${basename(label).replace(/[^\w.-]/g, "_")}.${options.module ? "mjs" : "cjs"}`);
    await writeFile(temp, code, "utf8");
    const verdict = await nodeCheck(label, temp);
    return verdict;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const PROBE_TIMEOUT_MS = 1e4;
const C_LOCALE_ENV = {
  LC_ALL: "C",
  LANGUAGE: void 0
};
const PYTHON_ENV = {
  ...C_LOCALE_ENV,
  PYTHONUTF8: "1"
};
const PYTHON_KIND = {
  name: "python",
  candidates: (platform) => [
    { cmd: "python3", args: [], label: "python3" },
    { cmd: "python", args: [], label: "python" },
    ...platform === "win32" ? [{ cmd: "py", args: ["-3"], label: "py -3" }] : []
  ],
  // Prints the major version: rejects stubs and Python 2 alike.
  probeArgs: ["-c", "import sys; sys.stdout.write(str(sys.version_info[0]))"],
  probeOk: (run) => run.exitCode === 0 && run.stdout.trim() === "3",
  // UTF-8 stderr on Windows too, where the console code page would garble it.
  env: PYTHON_ENV
};
const SHELL_KIND = {
  name: "shell",
  // On Windows System32 `bash` is the WSL launcher, whose Linux bash cannot
  // open `C:\...` even when a distribution exists. An `sh` on PATH there
  // usually comes from Git for Windows, MSYS2 or Cygwin, which do take
  // Windows paths, so it is tried first.
  candidates: (platform) => (platform === "win32" ? ["sh", "bash"] : ["bash", "sh"]).map((cmd) => ({
    cmd,
    args: [],
    label: cmd
  })),
  probeArgs: ["-c", "exit 0"],
  probeOk: (run) => run.exitCode === 0,
  env: C_LOCALE_ENV
};
const resolvedInterpreters = /* @__PURE__ */ new WeakMap();
function interpreterCache(run) {
  let byKind = resolvedInterpreters.get(run);
  if (byKind === void 0) {
    byKind = /* @__PURE__ */ new Map();
    resolvedInterpreters.set(run, byKind);
  }
  return byKind;
}
function resolveInterpreter(kind, run, platform) {
  const cache = interpreterCache(run);
  const key = `${kind.name}:${platform}`;
  const cached = cache.get(key);
  if (cached !== void 0) return cached;
  const pending = (async () => {
    for (const candidate of kind.candidates(platform)) {
      const probe = await run(candidate.cmd, [...candidate.args, ...kind.probeArgs], {
        timeoutMs: PROBE_TIMEOUT_MS,
        env: kind.env
      });
      if (probe.missing || probe.timedOut) continue;
      if (kind.probeOk(probe)) return candidate;
    }
    return null;
  })();
  cache.set(key, pending);
  const forget = () => {
    if (cache.get(key) === pending) cache.delete(key);
  };
  pending.then((found) => {
    if (found === null) forget();
  }, forget);
  return pending;
}
function forgetInterpreter(kind, run, platform) {
  interpreterCache(run).delete(`${kind.name}:${platform}`);
}
const PYTHON_COMPILE = "import sys; compile(open(sys.argv[1], 'rb').read(), sys.argv[1], 'exec')";
const PYTHON_SYNTAX_ERROR = /\b(?:SyntaxError|IndentationError|TabError)\b|\bsource code (?:string )?cannot contain null bytes\b/;
const SHELL_SYNTAX_ERROR = /\b(?:syntax error|parse error)\b|\bunexpected\b/i;
const PYTHON_CHECK = {
  kind: PYTHON_KIND,
  args: (file) => ["-c", PYTHON_COMPILE, file],
  suffix: "compile()",
  syntaxError: PYTHON_SYNTAX_ERROR,
  noneFound: "no working Python 3 found"
};
const SHELL_CHECK = {
  kind: SHELL_KIND,
  args: (file) => ["-n", file],
  suffix: "-n",
  syntaxError: SHELL_SYNTAX_ERROR,
  noneFound: "no working shell found"
};
async function checkWithInterpreter(spec, file, options) {
  const run = options.run ?? runChecker;
  const platform = options.platform ?? process.platform;
  const interpreter = await resolveInterpreter(spec.kind, run, platform);
  if (interpreter === null) {
    return { file, ok: null, checker: "none", error: spec.noneFound };
  }
  const checker = `${interpreter.label} ${spec.suffix}`;
  const out = await run(interpreter.cmd, [...interpreter.args, ...spec.args(file)], {
    env: spec.kind.env
  });
  if (out.missing) {
    forgetInterpreter(spec.kind, run, platform);
    return didNotRun(file, checker, out);
  }
  if (out.timedOut) return { file, ok: null, checker, error: "timed out" };
  if (out.exitCode === 0) return { file, ok: true, checker };
  const escaped = JSON.stringify(file).slice(1, -1);
  const stderr = out.stderr.split(file).join("<file>").split(escaped).join("<file>");
  if (!spec.syntaxError.test(stderr)) {
    return didNotRun(file, checker, out);
  }
  return { file, ok: false, checker, error: tailOfOutput(out.stderr, 4) };
}
function didNotRun(file, checker, run) {
  return {
    file,
    ok: null,
    checker,
    error: `${checker} did not run: ${tailOfOutput(`${run.stderr}
${run.stdout}`, 2) || `exit ${run.exitCode}`}`
  };
}
function checkPythonFile(file, options = {}) {
  return checkWithInterpreter(PYTHON_CHECK, file, options);
}
function checkShellFile(file, options = {}) {
  return checkWithInterpreter(SHELL_CHECK, file, options);
}
export {
  checkJavaScriptFile,
  checkJavaScriptSource,
  checkPythonFile,
  checkShellFile,
  nodeCheck,
  nodeForSyntaxCheck,
  runChecker
};
