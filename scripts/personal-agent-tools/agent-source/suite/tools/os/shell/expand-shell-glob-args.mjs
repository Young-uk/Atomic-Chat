import { globSync } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveUserPath } from "../expand-home.mjs";
import { basenameCommand } from "../shell-command-guard/normalise.mjs";
const MAX_GLOB_MATCHES = 1e4;
const RELATIVE_GLOB_CMDS = /* @__PURE__ */ new Set([
  "rm",
  "cp",
  "mv",
  "chmod",
  "chown",
  "touch",
  "ls",
  "unlink",
  "rmdir"
]);
const CODE_PAYLOAD_CMDS = /* @__PURE__ */ new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "python",
  "python3"
]);
function isCodePayloadCmd(cmd) {
  const bin = basenameCommand(cmd).toLowerCase().replace(/\.exe$/, "");
  if (CODE_PAYLOAD_CMDS.has(bin)) return true;
  return /^python\d+(\.\d+)*$/.test(bin);
}
function isCodePayloadFlag(arg) {
  return /^-[a-zA-Z]*c$/.test(arg) || arg === "--command";
}
const URL_RE = /^[a-z][a-z0-9+.-]+:\/\//i;
function hasGlobMetachar(arg) {
  return /[*?]/.test(arg);
}
function isUrlLike(arg) {
  return URL_RE.test(arg);
}
function codePayloadIndices(cmd, args) {
  const marked = /* @__PURE__ */ new Set();
  if (!isCodePayloadCmd(cmd)) return marked;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (isCodePayloadFlag(arg)) {
      if (i + 1 < args.length) marked.add(i + 1);
      break;
    }
    if (!arg.startsWith("-")) break;
  }
  return marked;
}
function shouldExpandGlobArg(cmd, arg) {
  if (!hasGlobMetachar(arg)) return false;
  if (arg.startsWith("-")) return false;
  if (isUrlLike(arg)) return false;
  if (arg.startsWith("/") || arg.startsWith("~/") || arg.startsWith("./") || arg.startsWith("../")) {
    return true;
  }
  if (/[/\\]/.test(arg)) return true;
  return RELATIVE_GLOB_CMDS.has(cmd);
}
function globMatches(pattern, cwd) {
  const matches = globSync(pattern, {
    cwd: isAbsolute(pattern) ? void 0 : cwd
  });
  return matches.slice(0, MAX_GLOB_MATCHES);
}
function expandShellGlobArgs(cmd, args, cwd) {
  const codePayloads = codePayloadIndices(cmd, args);
  const out = [];
  for (const [index, arg] of args.entries()) {
    if (codePayloads.has(index) || !shouldExpandGlobArg(cmd, arg)) {
      out.push(arg);
      continue;
    }
    const pattern = arg.startsWith("~") ? resolveUserPath(arg, cwd) : arg;
    const resolvedPattern = isAbsolute(pattern) ? pattern : resolveUserPath(pattern, cwd);
    let matches;
    try {
      matches = globMatches(resolvedPattern, cwd);
    } catch {
      out.push(arg);
      continue;
    }
    if (matches.length === 0) {
      out.push(arg);
      continue;
    }
    out.push(...matches);
  }
  return out;
}
export {
  expandShellGlobArgs
};
