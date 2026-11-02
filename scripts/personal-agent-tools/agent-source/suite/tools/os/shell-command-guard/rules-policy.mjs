const NETWORK_VERBS = /* @__PURE__ */ new Set([
  "push",
  "fetch",
  "pull",
  "clone"
]);
const REMOTE_MUTATORS = /* @__PURE__ */ new Set(["add", "set-url"]);
const GLOBAL_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path"
]);
const GIT_REMOTE_SYNC_OFF_RULE = "policy.git_remote_sync_off";
const GIT_REMOTE_SYNC_OFF_REASON = "remote sync is off \u2014 this repository stays on this machine (Integrations \u2192 GitHub \u2192 Remote sync)";
function readGitSubcommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { verb: arg.toLowerCase(), next: args[i + 1] };
  }
  return null;
}
function buildGitRemotePolicyRule(policy) {
  return {
    id: "policy.git_remote_sync",
    layer: "policy",
    match(input) {
      if (input.cmd !== "git") return null;
      if (policy.isGitRemoteSyncEnabled()) return null;
      const sub = readGitSubcommand(input.args);
      if (!sub) return null;
      const blocked = NETWORK_VERBS.has(sub.verb) || sub.verb === "remote" && sub.next !== void 0 && REMOTE_MUTATORS.has(sub.next.toLowerCase());
      if (!blocked) return null;
      return {
        action: "block",
        rule: GIT_REMOTE_SYNC_OFF_RULE,
        reason: GIT_REMOTE_SYNC_OFF_REASON
      };
    }
  };
}
export {
  GIT_REMOTE_SYNC_OFF_REASON,
  GIT_REMOTE_SYNC_OFF_RULE,
  buildGitRemotePolicyRule,
  readGitSubcommand
};
