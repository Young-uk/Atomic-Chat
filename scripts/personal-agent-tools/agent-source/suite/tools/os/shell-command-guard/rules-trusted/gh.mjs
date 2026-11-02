const GH_READ_VERBS = /* @__PURE__ */ new Set([
  "list",
  "view",
  "status",
  "diff",
  "checks",
  "browse",
  "search"
]);
const GH_WRITE_VERBS = /* @__PURE__ */ new Set([
  "create",
  "merge",
  "close",
  "delete",
  "edit",
  "add",
  "remove",
  "rename",
  "clone",
  "checkout",
  "sync",
  "fork",
  "comment",
  "review",
  "ready",
  "reopen",
  "lock",
  "unlock",
  "pin",
  "unpin",
  "transfer",
  "archive",
  "unarchive",
  "set",
  "set-default",
  "download",
  "upload",
  "cancel",
  "rerun",
  "disable",
  "enable",
  "login",
  "logout",
  "refresh",
  "token",
  "setup-git",
  "develop",
  "restore",
  "import",
  "update"
]);
const GH_API_FIELD_FLAGS = /* @__PURE__ */ new Set([
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "--input"
]);
const METHOD_PREFIX = "--method=";
const ghReadOnlyRule = {
  id: "gh.read_only",
  layer: "trusted",
  match(input) {
    if (input.cmd !== "gh") return null;
    const positionals = readPositionals(input.args);
    if (positionals.length === 0) return null;
    if (positionals[0] === "api") {
      if (!isReadOnlyGhApi(input.args)) return null;
      return {
        action: "allow",
        rule: "gh.api_read",
        reason: "gh api read-only request"
      };
    }
    if (positionals.some((word) => GH_WRITE_VERBS.has(word))) return null;
    const reads = positionals.filter((word) => GH_READ_VERBS.has(word));
    if (reads.length === 0) return null;
    return {
      action: "allow",
      rule: "gh.read_only",
      reason: `gh read-only command (${reads.join(",")})`
    };
  }
};
function readPositionals(args) {
  const words = [];
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    words.push(arg.toLowerCase());
  }
  return words;
}
function isReadOnlyGhApi(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (GH_API_FIELD_FLAGS.has(arg)) return false;
    if (arg === "-X" || arg === "--method") {
      if (!isReadMethod(args[i + 1] ?? "")) return false;
      i += 1;
      continue;
    }
    if (arg.startsWith(METHOD_PREFIX)) {
      if (!isReadMethod(arg.slice(METHOD_PREFIX.length))) return false;
    }
  }
  return true;
}
function isReadMethod(value) {
  const method = value.toUpperCase();
  return method === "GET" || method === "HEAD";
}
export {
  ghReadOnlyRule
};
