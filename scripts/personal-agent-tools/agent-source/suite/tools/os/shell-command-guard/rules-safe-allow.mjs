const ZERO_ARG_SAFE = /* @__PURE__ */ new Set([
  "date",
  "hostname",
  "id",
  "pwd",
  "tty",
  "uptime",
  "whoami",
  // Windows read-only builtins.
  "ver"
]);
const VERSION_SAFE_COMMANDS = /* @__PURE__ */ new Set([
  "bun",
  "cargo",
  "deno",
  "go",
  "java",
  "node",
  "npm",
  "pip",
  "pip3",
  "pnpm",
  "python",
  "python3",
  "ruby",
  "rustc",
  "yarn"
]);
const VERSION_FLAGS = /* @__PURE__ */ new Set(["--version", "-v", "-V"]);
const SHELL_METACHARS = /[`$<>|&;()*?{}\[\]\\]/;
const safeAllowRule = {
  id: "safe-allow",
  layer: "safe-allow",
  match(input) {
    return matchZeroArg(input) ?? matchVersionProbe(input) ?? matchWhichProbe(input) ?? matchWhereProbe(input) ?? matchCommandProbe(input) ?? matchEchoLiteral(input);
  }
};
function matchZeroArg(input) {
  if (!ZERO_ARG_SAFE.has(input.cmd) || input.args.length !== 0) return null;
  return {
    action: "allow",
    rule: `safe.${input.cmd}`,
    reason: `${input.cmd} zero-argument read-only command`
  };
}
function matchVersionProbe(input) {
  if (!VERSION_SAFE_COMMANDS.has(input.cmd)) return null;
  if (input.args.length !== 1 || !VERSION_FLAGS.has(input.args[0] ?? ""))
    return null;
  return {
    action: "allow",
    rule: "safe.version_probe",
    reason: `${input.cmd} version probe`
  };
}
function matchWhichProbe(input) {
  if (input.cmd !== "which") return null;
  if (input.args.length !== 1 || hasShellMetachar(input.args[0] ?? ""))
    return null;
  return {
    action: "allow",
    rule: "safe.which_probe",
    reason: "which command probe"
  };
}
function matchWhereProbe(input) {
  if (input.cmd !== "where" && input.cmd !== "where.exe") return null;
  if (input.args.length !== 1 || hasShellMetachar(input.args[0] ?? ""))
    return null;
  return {
    action: "allow",
    rule: "safe.where_probe",
    reason: "where command probe"
  };
}
function matchCommandProbe(input) {
  if (input.cmd !== "command") return null;
  if (input.args.length !== 2 || input.args[0] !== "-v") return null;
  if (hasShellMetachar(input.args[1] ?? "")) return null;
  return {
    action: "allow",
    rule: "safe.command_probe",
    reason: "command -v probe"
  };
}
function matchEchoLiteral(input) {
  if (input.cmd !== "echo") return null;
  if (input.args.some(hasShellMetachar)) return null;
  return {
    action: "allow",
    rule: "safe.echo_literal",
    reason: "echo literal"
  };
}
function hasShellMetachar(value) {
  return SHELL_METACHARS.test(value);
}
export {
  safeAllowRule
};
