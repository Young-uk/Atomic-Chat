import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { isInside } from "../../approval/fanout-scope.mjs";
import { resolveUserPath } from "../os/expand-home.mjs";
import { canonical } from "./read-scope.mjs";
import { shellCommandLine } from "./read-scope-shell.mjs";
import { READ_TOOL_TARGETS, URL_LIKE } from "./read-scope-targets.mjs";
const RECURSIVE_READ_TOOLS = /* @__PURE__ */ new Set(["os.fs.grep", "os.fs.move"]);
function canonicalSecrets(secrets) {
  const lexicalState = resolve(secrets.stateDir);
  const states = [lexicalState, canonical(lexicalState)];
  const files = /* @__PURE__ */ new Set();
  const folders = /* @__PURE__ */ new Set();
  for (const file of secrets.files) {
    const lexical = resolve(file);
    for (const spelling of [lexical, canonical(lexical)]) {
      files.add(spelling);
      const state = states.find((dir) => isInside(dir, spelling));
      if (state === void 0) continue;
      for (let dir = dirname(spelling); isInside(state, dir); dir = dirname(dir)) {
        folders.add(dir);
        if (dir === dirname(dir)) break;
      }
    }
  }
  return { files: [...files], folders: [...folders] };
}
function samePath(a, b) {
  return a === b || isInside(a, b) && isInside(b, a);
}
function secretNamedBy(path, known, folders) {
  const real = canonical(path);
  for (const file of known.files) {
    if (samePath(file, path) || samePath(file, real)) return file;
  }
  if (folders && known.folders.some((dir) => samePath(dir, path) || samePath(dir, real))) {
    return path;
  }
  return null;
}
function findStateSecretReads(tool, args, ctx, secrets) {
  const targetsOf = READ_TOOL_TARGETS.get(tool);
  if (targetsOf === void 0 || secrets.files.length === 0) return [];
  const known = canonicalSecrets(secrets);
  const hits = /* @__PURE__ */ new Set();
  for (const target of targetsOf(args)) {
    if (URL_LIKE.test(target)) continue;
    let path;
    try {
      path = resolveUserPath(target, ctx.workingDir);
    } catch {
      continue;
    }
    const hit = secretNamedBy(path, known, RECURSIVE_READ_TOOLS.has(tool));
    if (hit !== null) hits.add(hit);
  }
  return [...hits];
}
const TOKEN_SPLIT = /[\s;|&<>()`{},]+/;
const GLOB = /[*?[]/;
function expandVariables(line, home, stateDir) {
  return line.replace(/\$\{ATOMIC_AGENT_STATE_DIR\}|\$ATOMIC_AGENT_STATE_DIR\b/g, stateDir).replace(/%ATOMIC_AGENT_STATE_DIR%|\$env:ATOMIC_AGENT_STATE_DIR\b/gi, stateDir).replace(/\$\{HOME\}|\$HOME\b/g, home).replace(/%USERPROFILE%|\$env:USERPROFILE\b|\$env:HOME\b/gi, home);
}
function globToRegExp(pattern, platform) {
  const sep = platform === "win32" ? "[\\\\/]" : "/";
  const notSep = platform === "win32" ? "[^\\\\/]" : "[^/]";
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else out += `${notSep}*`;
    } else if (c === "?") out += notSep;
    else if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) out += "\\[";
      else {
        out += `[${pattern.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = close;
      }
    } else if (c === "/" || platform === "win32" && c === "\\") out += sep;
    else out += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, platform === "win32" ? "i" : "");
}
function pathOfToken(token, cwd, home) {
  let t = token;
  const eq = t.indexOf("=");
  if (eq >= 0) t = t.slice(eq + 1);
  t = t.replace(/^@/, "");
  if (t.length === 0 || URL_LIKE.test(t)) return null;
  if (t === "~") return home;
  if (t.startsWith("~/") || t.startsWith("~\\")) return resolve(home, t.slice(2));
  return isAbsolute(t) ? resolve(t) : resolve(cwd, t);
}
function findShellStateSecrets(args, ctx, secrets, env = { home: homedir(), platform: process.platform }) {
  if (secrets.files.length === 0) return [];
  const known = canonicalSecrets(secrets);
  let cwd = ctx.workingDir;
  if (typeof args.cwd === "string" && args.cwd.length > 0) {
    try {
      cwd = resolveUserPath(args.cwd, ctx.workingDir);
    } catch {
      cwd = ctx.workingDir;
    }
  }
  let line = expandVariables(shellCommandLine(args), env.home, secrets.stateDir);
  line = line.replace(/["']/g, "");
  if (env.platform !== "win32") line = line.replace(/\\/g, "");
  const hits = /* @__PURE__ */ new Set();
  for (const file of known.files) {
    if (spelledOut(line, file)) hits.add(file);
  }
  const candidates = [...known.files, ...known.folders];
  for (const token of line.split(TOKEN_SPLIT)) {
    if (token.length === 0) continue;
    const path = pathOfToken(token, cwd, env.home);
    if (path === null) continue;
    if (GLOB.test(path)) {
      const pattern = globToRegExp(path, env.platform);
      for (const candidate of candidates) {
        if (pattern.test(candidate)) hits.add(candidate);
      }
      continue;
    }
    const hit = secretNamedBy(path, known, true);
    if (hit !== null) hits.add(hit);
  }
  return dedupe([...hits]);
}
function spelledOut(line, file) {
  for (let at = line.indexOf(file); at !== -1; at = line.indexOf(file, at + 1)) {
    const next = line[at + file.length];
    if (next === void 0 || !/[\w.-]/.test(next)) return true;
  }
  return false;
}
function dedupe(paths) {
  const out = [];
  for (const path of paths) {
    const real = canonical(path);
    if (!out.some((seen) => samePath(canonical(seen), real))) out.push(path);
  }
  return out;
}
function stateSecretReadPrompt(paths) {
  return `read ${paths.join(", ")} \u2014 the agent's own secret file (API keys, tokens, approval settings); asked every time, never granted for the session`;
}
function stateSecretShellPrompt(commandLine, paths) {
  return `run \`${commandLine}\` \u2014 it names the agent's own secret files (API keys, tokens, approval settings): ${paths.join(", ")}; asked every time, never granted for the session`;
}
export {
  findShellStateSecrets,
  findStateSecretReads,
  stateSecretReadPrompt,
  stateSecretShellPrompt
};
