import { readFileSync } from "node:fs";
import { join } from "node:path";
const RETRYABLE_READ_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY", "EAGAIN"]);
const READ_ATTEMPTS = 3;
const READ_BACKOFF_MS = [50, 150];
const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function stripQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' && last === '"' || first === "'" && last === "'") {
    return value.slice(1, -1);
  }
  return value;
}
function parseLine(line, lineNo, onError) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) {
    onError(`missing '=' on line ${lineNo} (${trimmed.length} chars)`);
    return null;
  }
  const key = trimmed.slice(0, eq).trim();
  const rawValue = trimmed.slice(eq + 1).trim();
  if (!KEY_PATTERN.test(key)) {
    onError(`invalid key '${key}'`);
    return null;
  }
  return [key, stripQuotes(rawValue)];
}
function readWithRetry(path, deps) {
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      return { kind: "ok", raw: deps.readFile(path) };
    } catch (err) {
      const code = err.code ?? null;
      if (code === "ENOENT") return { kind: "missing" };
      const failure = { code, attempts: attempt };
      if (!code || !RETRYABLE_READ_CODES.has(code)) {
        return { kind: "failed", failure };
      }
      if (attempt === READ_ATTEMPTS) {
        return { kind: "failed", failure };
      }
      deps.sleep(
        READ_BACKOFF_MS[attempt - 1] ?? READ_BACKOFF_MS[READ_BACKOFF_MS.length - 1] ?? 50
      );
    }
  }
  return { kind: "missing" };
}
function formatDotenvReadWarning(path, failure, platform = process.platform) {
  const attempts = failure.attempts === 1 ? "1 attempt" : `${failure.attempts} attempts`;
  const code = failure.code ?? "unknown error";
  const fix = platform === "win32" ? `Fix: clear the file's read-only attribute (right-click the file, Properties), add an antivirus exclusion for the folder, or reset its permissions: icacls "${path}" /reset` : `Fix: check the file's owner and permissions (ls -l "${path}"), then chmod 600 "${path}" as the user that runs atomic-agent.`;
  return [
    `Could not read secrets file: ${path} (${code} after ${attempts}).`,
    "Saved API keys and tokens from .env were NOT loaded this run.",
    fix
  ].join("\n");
}
function loadDotenvFromStateDir(stateDir, deps = {}) {
  const io = {
    readFile: deps.readFile ?? ((p) => readFileSync(p, "utf8")),
    sleep: deps.sleep ?? sleepSync
  };
  const path = join(stateDir, ".env");
  const result = {
    path,
    exists: false,
    loaded: [],
    skipped: [],
    error: null
  };
  const read = readWithRetry(path, io);
  if (read.kind === "missing") return result;
  if (read.kind === "failed") {
    result.error = read.failure;
    process.stderr.write(
      `atomic-agent: ${formatDotenvReadWarning(path, read.failure)}
`
    );
    return result;
  }
  result.exists = true;
  const lines = read.raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseLine(lines[i] ?? "", i + 1, (reason) => {
      process.stderr.write(
        `atomic-agent: skipping ${path} entry \u2014 ${reason}
`
      );
    });
    if (parsed === null) continue;
    const [key, value] = parsed;
    const existing = process.env[key];
    if (existing !== void 0 && existing.length > 0) {
      result.skipped.push(key);
      continue;
    }
    process.env[key] = value;
    result.loaded.push(key);
  }
  return result;
}
export {
  formatDotenvReadWarning,
  loadDotenvFromStateDir
};
