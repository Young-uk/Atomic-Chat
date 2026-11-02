import {
  buildDirectInvocation,
  buildSubshellInvocation,
  quoteCmdArg
} from "../../../sandbox/shell-invocation.mjs";
function coerceShellArgs(value) {
  if (value === void 0 || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v));
        }
      } catch {
      }
    }
  }
  return null;
}
function describeArgsShape(value) {
  if (value === void 0) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
const SHELL_METACHAR_RE = /[|&;<>$`(){}]/;
const WINDOWS_CMD_BUILTINS = /* @__PURE__ */ new Set([
  "assoc",
  "call",
  "cd",
  "chdir",
  "cls",
  "color",
  "copy",
  "date",
  "del",
  "dir",
  "echo",
  "erase",
  "ftype",
  "md",
  "mkdir",
  "mklink",
  "move",
  "path",
  "pause",
  "popd",
  "prompt",
  "pushd",
  "rd",
  "rem",
  "ren",
  "rename",
  "rmdir",
  "set",
  "start",
  "time",
  "title",
  "type",
  "ver",
  "verify",
  "vol"
]);
function isWindowsCmdBuiltin(cmd) {
  return WINDOWS_CMD_BUILTINS.has(cmd.trim().toLowerCase());
}
function needsShellInterpretation(cmd, args) {
  if (SHELL_METACHAR_RE.test(cmd)) return true;
  if (process.platform === "win32" && /%[^%\s]+%/.test(cmd)) return true;
  if (process.platform === "win32" && !/\s/.test(cmd.trim()) && isWindowsCmdBuiltin(cmd)) {
    return true;
  }
  if (args.length === 0 && /\s/.test(cmd.trim())) return true;
  return false;
}
function resolveShellSpawn(cmd, execArgs, useShell) {
  if (!useShell) return buildDirectInvocation(cmd, execArgs);
  return buildSubshellInvocation(subshellLine(cmd, execArgs));
}
function subshellLine(cmd, execArgs) {
  return execArgs.length > 0 && process.platform === "win32" ? [cmd, ...execArgs.map(quoteCmdArg)].join(" ") : [cmd, ...execArgs].join(" ");
}
const POSIX_PLAIN_TOKEN_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;
function quotePosixArg(token) {
  if (token.length === 0) return "''";
  if (POSIX_PLAIN_TOKEN_RE.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}
function formatShellPreview(cmd, execArgs, useShell) {
  if (useShell) return subshellLine(cmd, execArgs);
  const quote = process.platform === "win32" ? quoteCmdArg : quotePosixArg;
  return [cmd, ...execArgs].map(quote).join(" ");
}
const OPAQUE_INTERPRETER_SHAPES = /* @__PURE__ */ new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "cmd",
  "powershell",
  "pwsh",
  // Wrappers that run whatever binary their arguments name: a grant on
  // `env` or `xargs` would silence every binary behind it.
  "env",
  "xargs",
  "sudo",
  "doas",
  "nohup",
  "nice",
  "timeout",
  "time",
  "exec",
  "eval",
  "command",
  "builtin"
]);
function isOpaqueInterpreterShape(shape) {
  return OPAQUE_INTERPRETER_SHAPES.has(shape);
}
const SHELL_COMPOUND_RE = /[|&;<>$`(){}\r\n]/;
function shellGrantShape(guardCmd, commandLine, useShell) {
  if (useShell && SHELL_COMPOUND_RE.test(commandLine)) return void 0;
  const bin = guardCmd.trim();
  if (bin.length === 0 || /[\\/]/.test(bin)) return void 0;
  const shape = bin.toLowerCase();
  return isOpaqueInterpreterShape(shape) ? void 0 : shape;
}
export {
  coerceShellArgs,
  describeArgsShape,
  formatShellPreview,
  isOpaqueInterpreterShape,
  needsShellInterpretation,
  quotePosixArg,
  resolveShellSpawn,
  shellGrantShape
};
