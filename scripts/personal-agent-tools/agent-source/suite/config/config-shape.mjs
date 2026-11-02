import { USER_CONFIG_DEFAULTS } from "./config-schema.mjs";
const FIXED_CONFIG_BRANCHES = /* @__PURE__ */ new Set([
  "",
  "localModels",
  "localModels.managed",
  "localModels.embeddings",
  "localModels.download",
  "log",
  "agent",
  "agent.providerWait",
  "agent.task",
  "agent.compaction",
  "http",
  "web",
  "web.search",
  "web.search.searxng",
  "web.search.exa",
  "web.search.brave",
  "web.fetch",
  "projects",
  "tools",
  "tools.shell",
  "browser",
  "tools.screen",
  "sessions",
  "sessions.retention",
  "tracing",
  "tracing.trace",
  "memory",
  "memory.profile",
  "memory.reflection",
  "memory.reflection.typedNotes",
  "memory.reflection.segmentation",
  "memory.notes",
  "memory.recallInjection",
  "memory.index",
  "memory.dedup",
  "memory.eviction",
  "memory.embeddings",
  "memory.links",
  "memory.evolution",
  "memory.lessons",
  "memory.procedures",
  "memory.consolidation",
  "memory.voting",
  "memory.retrieve",
  "memory.retrieve.rewriter",
  "memory.retrieve.rewriter.embeddingGate",
  "vision",
  "skills",
  "skills.clawhub",
  "tui",
  "tui.notify",
  "tui.sessionRail",
  "tui.onboarding",
  "analytics",
  "telegram",
  "discord",
  "swarm",
  "notifications",
  "notifications.downloads",
  "atomicMail",
  "git",
  "composio",
  "mcp"
]);
const DICTIONARY_CONFIG_BRANCHES = /* @__PURE__ */ new Set([
  "webhooks",
  "mcp.servers",
  "llm.providers"
]);
const KNOWN_KEYS_OUTSIDE_DEFAULTS = {
  "": ["llm", "telemetry"],
  agent: ["approvalRequired"],
  discord: ["ownerUserId"]
};
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function buildChildIndex() {
  const children = /* @__PURE__ */ new Map();
  const walk = (node, path) => {
    const names = new Set(Object.keys(node));
    children.set(path, names);
    for (const [name, value] of Object.entries(node)) {
      if (isPlainObject(value)) {
        walk(value, path === "" ? name : `${path}.${name}`);
      }
    }
  };
  walk(USER_CONFIG_DEFAULTS, "");
  return children;
}
const CHILDREN = buildChildIndex();
function listDefaultConfigBranches() {
  return [...CHILDREN.keys()].filter((path) => path !== "");
}
function configBranchKind(path) {
  if (FIXED_CONFIG_BRANCHES.has(path)) return "fixed";
  if (DICTIONARY_CONFIG_BRANCHES.has(path)) return "dictionary";
  return void 0;
}
function knownConfigKeys(path) {
  return /* @__PURE__ */ new Set([
    ...CHILDREN.get(path) ?? [],
    ...KNOWN_KEYS_OUTSIDE_DEFAULTS[path] ?? []
  ]);
}
export {
  DICTIONARY_CONFIG_BRANCHES,
  FIXED_CONFIG_BRANCHES,
  configBranchKind,
  knownConfigKeys,
  listDefaultConfigBranches
};
