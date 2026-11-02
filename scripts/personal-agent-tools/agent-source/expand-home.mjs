import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
function expandHome(path) {
  if (typeof path !== "string" || path.length === 0) return path;
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}
function isPosixAbsoluteOnWindows(p) {
  if (process.platform !== "win32") return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (/^[\\/]{2}/.test(p)) return false;
  return p.startsWith("/");
}
function resolveUserPath(input, workingDir) {
  const expanded = expandHome(input);
  if (isPosixAbsoluteOnWindows(expanded)) {
    throw new Error(
      `Unix-absolute path "${input}" is ambiguous on Windows. Use a Windows path (e.g. "C:\\Users\\...") or a path relative to the working directory.`
    );
  }
  return isAbsolute(expanded) ? expanded : resolve(workingDir, expanded);
}
export {
  expandHome,
  resolveUserPath
};
