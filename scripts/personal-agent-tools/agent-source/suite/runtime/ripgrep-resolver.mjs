import { statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
let cached;
function resolveRipgrepPath(options = {}) {
  if (Object.keys(options).length === 0 && cached !== void 0) {
    return cached;
  }
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? defaultFileExists;
  const binaryName = platform === "win32" ? "rg.exe" : "rg";
  const override = env.ATOMIC_AGENT_RG_PATH;
  if (typeof override === "string" && override.length > 0) {
    if (fileExists(override)) {
      const result = override;
      if (Object.keys(options).length === 0) cached = result;
      return result;
    }
  }
  const bundled = join(dirname(execPath), "vendor", binaryName);
  if (fileExists(bundled)) {
    if (Object.keys(options).length === 0) cached = bundled;
    return bundled;
  }
  const devModule = join(
    cwd,
    "node_modules",
    "@vscode",
    "ripgrep",
    "bin",
    binaryName
  );
  if (fileExists(devModule)) {
    if (Object.keys(options).length === 0) cached = devModule;
    return devModule;
  }
  const fromPath = lookupOnPath(binaryName, env, platform, fileExists);
  if (fromPath) {
    if (Object.keys(options).length === 0) cached = fromPath;
    return fromPath;
  }
  if (Object.keys(options).length === 0) cached = null;
  return null;
}
function resetRipgrepCache() {
  cached = void 0;
}
function defaultFileExists(path) {
  try {
    const info = statSync(path);
    return info.isFile();
  } catch {
    return false;
  }
}
function lookupOnPath(binaryName, env, platform, fileExists) {
  const pathVar = env.PATH ?? env.Path ?? env.path ?? "";
  if (pathVar.length === 0) return null;
  const segments = pathVar.split(delimiter);
  const candidates = platform === "win32" ? [binaryName, "rg.exe", "rg.cmd", "rg.bat"] : [binaryName];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    for (const name of candidates) {
      const full = join(segment, name);
      if (fileExists(full)) return full;
    }
  }
  return null;
}
const RIPGREP_MISSING_HINT = "ripgrep (`rg`) was not found. Install it via `brew install ripgrep`, `apt install ripgrep`, or `choco install ripgrep`, or set ATOMIC_AGENT_RG_PATH to a binary path.";
export {
  RIPGREP_MISSING_HINT,
  resetRipgrepCache,
  resolveRipgrepPath
};
