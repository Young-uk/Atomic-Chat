import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { resolveUserPath } from "../os/expand-home.mjs";
import {
  isOutsideReadRoots,
  isScratchPath,
  isUnderAny
} from "./read-scope.mjs";
function defaultShellScopeEnv() {
  return { home: homedir(), platform: process.platform };
}
const SYSTEM_PREFIXES = {
  posix: [
    "/usr",
    "/bin",
    "/sbin",
    "/opt",
    "/dev",
    "/etc",
    "/System",
    "/Library",
    "/Applications"
  ],
  win32: ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"]
};
const DRIVE = /^[A-Za-z]:[\\/]/;
const QUOTES = /^["'`]+|["'`]+$/g;
const REDIRECT = /^[0-9]*[<>]+/;
const TRAILING = /[;|&),\]]+$/;
function hasClimb(token) {
  return token.split(/[\\/]/).includes("..");
}
function shellCommandLine(args) {
  const parts = [];
  if (typeof args.cmd === "string") parts.push(args.cmd);
  const list = args.args;
  if (Array.isArray(list)) {
    parts.push(...list.map(String));
  } else if (typeof list === "string" && list.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(list);
      if (Array.isArray(parsed)) parts.push(...parsed.map(String));
    } catch {
    }
  }
  return parts.join(" ");
}
function shellTokens(args) {
  return shellCommandLine(args).split(/\s+/).filter((token) => token.length > 0);
}
function candidateOf(token, cwd, env) {
  let t = token.replace(QUOTES, "").replace(REDIRECT, "").replace(TRAILING, "");
  const eq = t.indexOf("=");
  if (eq > 0) {
    const value = t.slice(eq + 1);
    if (/^(~|\/|[A-Za-z]:[\\/])/.test(value)) t = value;
  }
  if (t === "~") return { path: env.home, climb: false };
  if (t.startsWith("~/") || t.startsWith("~\\")) {
    return { path: resolve(env.home, t.slice(2)), climb: false };
  }
  if (env.platform === "win32") {
    if (DRIVE.test(t)) return { path: resolve(t), climb: false };
  } else if (t.startsWith("/")) {
    return t.startsWith("//") ? null : { path: resolve(t), climb: false };
  }
  if (hasClimb(t) && !DRIVE.test(t)) return { path: resolve(cwd, t), climb: true };
  return null;
}
function findShellPathOutsideScope(args, ctx, roots, env = defaultShellScopeEnv()) {
  const system = SYSTEM_PREFIXES[env.platform === "win32" ? "win32" : "posix"];
  const homeParent = dirname(env.home);
  const userArea = [
    env.home,
    ...homeParent === env.home || dirname(homeParent) === homeParent ? [] : [homeParent]
  ];
  let cwd = ctx.workingDir;
  if (typeof args.cwd === "string" && args.cwd.length > 0) {
    try {
      cwd = resolveUserPath(args.cwd, ctx.workingDir);
    } catch {
      cwd = ctx.workingDir;
    }
  }
  const candidates = [];
  if (cwd !== ctx.workingDir) candidates.push({ path: cwd, climb: false });
  for (const token of shellTokens(args)) {
    const candidate = candidateOf(token, cwd, env);
    if (candidate !== null) candidates.push(candidate);
  }
  for (const { path, climb } of candidates) {
    if (isUnderAny(path, system) || isScratchPath(path)) continue;
    if (!isOutsideReadRoots(path, roots)) continue;
    if (climb || isUnderAny(path, userArea)) return path;
  }
  return null;
}
export {
  defaultShellScopeEnv,
  findShellPathOutsideScope,
  shellCommandLine,
  shellTokens
};
