import { createAgentDefaults } from "./agent/agent-defaults.mjs";
import { parseAgentConfig } from "./agent/agent-parser.mjs";
import { READ_SCOPES, parseReadScope, parseApprovalLevel, CONVERSATION_MAX_PAIRS_MIN, CONVERSATION_MAX_PAIRS_MAX } from "./agent/agent-parser.mjs";
import { createHttpDefaults, parseHttpConfig } from "./http-config.mjs";
import { parseHttpApprovalMode } from "./http-config.mjs";
import {
  createProjectsDefaults,
  createToolsDefaults,
  createVisionDefaults,
  parseProjectsConfig,
  parseToolsConfig,
  parseVisionConfig
} from "./tool-config.mjs";
import { createBrowserDefaults, parseBrowserConfig } from "./browser-config.mjs";
import { createSkillsDefaults, parseSkillsConfig, parseClawHubConfigWithDefaults, DEFAULT_SKILLS_CATALOG_BUDGET } from "./skills-config.mjs";
import { DEFAULT_SKILLS_CATALOG_BUDGET as DEFAULT_SKILLS_CATALOG_BUDGET2, parseSkillNameArray, parseSkillTapArray } from "./skills-config.mjs";
import { createSessionDefaults, parseSessionConfig } from "./session-retention-config.mjs";
import { createTracingDefaults, parseTracingConfig } from "./tracing-config.mjs";
import {
  createTuiDefaults,
  parseTuiConfig,
  parseOnboardingStateWithDefaults,
  parseTuiNotifyWithDefaults
} from "./tui-config.mjs";
import {
  parseWhileBusySubmit,
  parseTimestampOrNull,
  parseThemeName
} from "./tui-config.mjs";
import {
  createTelegramDefaults,
  createDiscordDefaults,
  createSwarmDefaults,
  parseTelegramConfig,
  parseDiscordConfig,
  parseSwarmConfig
} from "./channel-config.mjs";
import {
  SWARM_UNIT_ID,
  parseTelegramOwnerId,
  parseDiscordOwnerUserIds
} from "./channel-config.mjs";
import {
  createNotificationsDefaults,
  createAtomicMailDefaults,
  createGitDefaults,
  createComposioDefaults,
  parseNotificationsConfig,
  parseAtomicMailConfig,
  parseGitConfig,
  parseComposioConfig
} from "./integration-config.mjs";
import {
  parseDownloadNotifyChannel
} from "./integration-config.mjs";
import { createLocalModelsDefaults } from "./local-models/local-models-defaults.mjs";
import {
  prepareLocalModelsInputs,
  parseUserLocalModelsConfig
} from "./local-models/local-models-parser.mjs";
import {
  parseLocalTemplateSetting,
  parseLocalLlmMode,
  parseBackendVariant,
  parseSwaFullPreference,
  parseLocalCompletionCap,
  parseReasoningBudgetTokens,
  parseTensorSplit
} from "./local-models/local-models-parser.mjs";
import { createMemoryDefaults } from "./memory/memory-defaults.mjs";
import {
  prepareMemoryInputs,
  parseMemoryConfig
} from "./memory/memory-parser.mjs";
import { parseRewriterGateMode } from "./memory/memory-parser.mjs";
import {
  createWebSearchDefaults,
  createWebFetchDefaults,
  prepareWebSearchInputs,
  parseWebSearchConfig,
  parseWebFetchConfig
} from "./web-config.mjs";
import {
  parseWebSearchProviderName,
  parseWebSearchFallback
} from "./web-config.mjs";
import { parseStringArrayOrNull, parseUrl } from "./config-values.mjs";
import { parseMcpServers } from "./mcp-server-config.mjs";
import { parseMcpServers as parseMcpServers2 } from "./mcp-server-config.mjs";
import {
  parseWebhookMap
} from "./webhook-config.mjs";
import {
  parseWebhookMap as parseWebhookMap2
} from "./webhook-config.mjs";
import {
  parseSessionRailConfig
} from "./session-rail-config.mjs";
import { parseBool } from "./config-primitives.mjs";
import {
  parsePositiveInt,
  parseBoundedPositiveInt,
  parseNonNegativeInt,
  parseNonNegativeBoundedInt,
  parseUnitInterval,
  parseHalfOpenUnitInterval,
  parseBool as parseBool2,
  parseBoolOrNull,
  parseNonEmptyString
} from "./config-primitives.mjs";
import {
  parseUserLlmFileConfig
} from "./llm-config.mjs";
import { defaultProviderModelMode } from "./model-mode.mjs";
const USER_CONFIG_VERSION = 79;
const SUPPORTED_INPUT_VERSIONS = [
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  62,
  63,
  64,
  65,
  66,
  67,
  68,
  69,
  70,
  71,
  72,
  73,
  74,
  75,
  76,
  77,
  78,
  USER_CONFIG_VERSION
];
const USER_CONFIG_DEFAULTS = {
  version: USER_CONFIG_VERSION,
  localModels: createLocalModelsDefaults(),
  log: { level: "info" },
  agent: createAgentDefaults(),
  http: createHttpDefaults(),
  web: {
    search: createWebSearchDefaults(),
    fetch: createWebFetchDefaults()
  },
  projects: createProjectsDefaults(),
  tools: createToolsDefaults(),
  browser: createBrowserDefaults(),
  sessions: createSessionDefaults(),
  tracing: createTracingDefaults(),
  memory: createMemoryDefaults(),
  webhooks: {},
  vision: createVisionDefaults(),
  skills: createSkillsDefaults(),
  tui: createTuiDefaults(),
  analytics: {
    enabled: true
  },
  telegram: createTelegramDefaults(),
  discord: createDiscordDefaults(),
  swarm: createSwarmDefaults(),
  notifications: createNotificationsDefaults(),
  atomicMail: createAtomicMailDefaults(),
  git: createGitDefaults(),
  composio: createComposioDefaults(),
  mcp: {
    // Added in v23. Empty by default — the operator declares MCP
    // servers explicitly. The runtime opens no connections when the
    // list is empty.
    servers: []
  }
};
const ENV_DEFAULTS = {
  STATE_DIR: "~/.atomic-agent",
  HEALTH_TIMEOUT_MS: 3e3,
  REQUEST_TIMEOUT_MS: 3e5,
  /**
   * 30 minutes. How long a local stream may wait for its first byte — see
   * `AtomicAgentConfig.localModels.firstTokenTimeoutMs`.
   *
   * Sized for the slowest honest wait fusion produces, not for one
   * request on an idle server: several workers on one GPU queue behind
   * each other's prompt evals, and a queued worker whose slot had not
   * yet evaluated a token was cancelled at the 300 s idle budget. A wait
   * that is really stuck still ends on the caller's own bounds (the
   * worker's turn timeout, Esc). Raise it with
   * `ATOMIC_AGENT_LLAMA_FIRST_TOKEN_TIMEOUT_MS`.
   */
  FIRST_TOKEN_TIMEOUT_MS: 30 * 60 * 1e3,
  /**
   * 6 hours. The backstop on a single streaming response — see
   * `AtomicAgentConfig.localModels.streamTotalTimeoutMs`.
   *
   * Chosen to clear the worst *honest* local generation by a wide
   * margin: the default `completionMaxTokens` of 8 192 tokens decoded at
   * 0.4 tok/s — slower than any CPU setup people actually sit through —
   * is about 5.7 h. It is also 72x `REQUEST_TIMEOUT_MS`, so the idle
   * deadline gets dozens of chances to fire first; if this one fires,
   * the server was streaming continuously for six hours without
   * finishing, which no local model this project targets does by
   * accident. Raise it with `ATOMIC_AGENT_LLAMA_STREAM_TOTAL_TIMEOUT_MS`
   * if you really do run a 131 072-token completion on a slow box.
   */
  STREAM_TOTAL_TIMEOUT_MS: 6 * 60 * 60 * 1e3,
  HEALTH_RETRIES: 5,
  HEALTH_BACKOFF_MS: 500,
  COMPLETION_RETRIES: 3,
  COMPLETION_RETRY_BACKOFF_MS: 150,
  DEFAULT_SLOT_ID: 0,
  STABLE_PREFIX_SALT: "atomic-agent-v1",
  BROWSER_ENABLED: true,
  BROWSER_CHANNEL: "chrome",
  BROWSER_HEADLESS: false,
  BROWSER_NO_SANDBOX: false,
  BROWSER_LAUNCH_TIMEOUT_MS: 3e4,
  SKILLS_CATALOG_BUDGET: DEFAULT_SKILLS_CATALOG_BUDGET,
  PROJECT_SKILLS_DIR: ".atomic-agent/skills",
  USER_CONFIG_FILE_NAME: "config.json",
  TASKS_ENABLED: true,
  TASKS_MAX_ATTEMPTS: 3,
  TASKS_BACKOFF_INITIAL_MS: 1e3,
  TASKS_BACKOFF_MAX_MS: 6e4,
  TASKS_RUN_ON_CREATE: true,
  TASKS_STALE_AFTER_MS: 5 * 60 * 1e3,
  TASKS_SCHEDULER_ENABLED: true,
  TASKS_SCHEDULER_TICK_MS: 5e3,
  TASKS_SCHEDULER_BATCH: 10,
  TASKS_AGENT_TOOLS_ENABLED: true,
  TASKS_MIN_INTERVAL_MS: 1e3,
  /** Fire the TUI startup version check against GitHub Releases. */
  UPDATE_CHECK_ON_STARTUP: true,
  /** GitHub `owner/repo` for self-update release lookups + install.sh. */
  UPDATE_REPO: "AtomicBot-ai/atomic-agent",
  /** Max rare-tool schema entries kept in `session.loadedTools` (LRU). */
  LOADED_TOOLS_CAP: 8,
  /** Safety cap (estimated tokens) for the `### loaded-tools` section. */
  LOADED_TOOLS_MAX_TOKENS: 600,
  /** Auto-attach full rare-tool schema after a tool execution error. */
  AUTO_EXPAND_RARE_ON_ERROR: true,
  /** Soft cap on tool calls per inference step. Hard upper bound is 16 (grammar). */
  MAX_PARALLEL_TOOL_CALLS: 8,
  /** Soft cap on combined chars across all tool_result summaries in one batched step. */
  BATCH_TOOL_RESULT_CHAR_CAP: 32e3,
  /**
   * Ingestion cap (chars) on a non-`gog` `os.shell.run` result summary.
   * This is the one line to change to pick a different default.
   */
  SHELL_TOOL_RESULT_CHAR_CAP: 16e3,
  /** Ingestion cap (tail lines) on a non-`gog` `os.shell.run` result summary. */
  SHELL_TOOL_RESULT_TAIL_LINES: 500,
  /** Args-only repeat count that injects a no-progress `### notice`. */
  LOOP_WARNING_THRESHOLD: 3,
  /** Identical args+result streak that vetoes a call before dispatch. */
  LOOP_CRITICAL_THRESHOLD: 5,
  /** Consecutive vetoes of one signature that force a graceful reply. */
  LOOP_BREAKER_VETO_STREAK: 3,
  /** Sliding window size for the loop tracker's history ring. */
  LOOP_HISTORY_SIZE: 30,
  /** Distinct-args run spread on a wandering-prone tool that redirects. */
  LOOP_WANDERING_THRESHOLD: 6,
  /** Run spread that escalates a wandering loop to a graceful reply. */
  LOOP_WANDERING_ESCALATION: 12
};
import { ConfigValidationError } from "./config-validation-error.mjs";
import { ConfigValidationError as ConfigValidationError2 } from "./config-validation-error.mjs";
function parseLogLevel(raw, field) {
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  throw new ConfigValidationError2(
    field,
    `expected one of debug|info|warn|error, got ${JSON.stringify(raw)}`
  );
}
function parseBrowserChannel(raw, field) {
  if (raw === "chrome" || raw === "msedge" || raw === "chromium") return raw;
  throw new ConfigValidationError2(
    field,
    `expected one of chrome|msedge|chromium, got ${JSON.stringify(raw)}`
  );
}
function parseClawHubConfig(raw) {
  return parseClawHubConfigWithDefaults(raw, () => USER_CONFIG_DEFAULTS.skills.clawhub);
}
const KNOWN_TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
  ...Object.keys(USER_CONFIG_DEFAULTS),
  // Emitted conditionally rather than defaulted.
  "llm",
  // Read as the legacy alias of `tracing` and intentionally not emitted;
  // treating it as unknown would carry a retired block forward for ever.
  "telemetry"
]);
function unknownTopLevelKeys(obj) {
  const extras = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__proto__") continue;
    if (KNOWN_TOP_LEVEL_KEYS.has(key)) continue;
    extras[key] = value;
  }
  return extras;
}
function parseUserConfigFile(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError2("<root>", "expected JSON object");
  }
  const obj = raw;
  const version = obj.version ?? USER_CONFIG_VERSION;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new ConfigValidationError2(
      "version",
      `unsupported config version ${JSON.stringify(version)}; expected a positive whole number`
    );
  }
  if (!SUPPORTED_INPUT_VERSIONS.includes(version) && version < USER_CONFIG_VERSION) {
    throw new ConfigValidationError2(
      "version",
      `unsupported config version ${JSON.stringify(version)}; expected one of ${SUPPORTED_INPUT_VERSIONS.join(", ")}`
    );
  }
  const localModels = obj.localModels ?? {};
  const log = obj.log ?? {};
  const agent = obj.agent ?? {};
  const http = obj.http ?? {};
  const web = obj.web ?? {};
  const projects = obj.projects ?? {};
  const tools = obj.tools ?? {};
  const toolsShell = tools.shell ?? {};
  const browser = obj.browser ?? {};
  const toolsScreen = tools.screen ?? {};
  const webSearch = web.search ?? {};
  const webFetch = web.fetch ?? {};
  const webSearchInputs = prepareWebSearchInputs(
    webSearch,
    () => USER_CONFIG_DEFAULTS.web.search
  );
  const sessions = obj.sessions ?? {};
  const sessionsRetention = sessions.retention ?? {};
  const legacyTelemetry = obj.telemetry ?? {};
  const tracing = obj.tracing ?? {};
  const traceFromLegacy = legacyTelemetry.trace ?? {};
  const traceFromTracing = tracing.trace ?? {};
  const mergedTrace = {
    ...traceFromLegacy,
    ...traceFromTracing
  };
  const memory = obj.memory ?? {};
  const preparedMemory = prepareMemoryInputs(memory);
  const webhooks = parseWebhookMap(obj.webhooks ?? {}, "webhooks");
  const vision = obj.vision ?? {};
  const skills = obj.skills ?? {};
  const telegram = obj.telegram ?? {};
  const composio = obj.composio ?? {};
  const discord = obj.discord ?? {};
  const swarm = obj.swarm ?? {};
  const notifications = obj.notifications ?? {};
  const notificationsDownloads = notifications.downloads ?? {};
  const atomicMail = obj.atomicMail ?? {};
  const git = obj.git ?? {};
  const tui = obj.tui ?? {};
  const analytics = obj.analytics ?? {};
  const mcp = obj.mcp ?? {};
  const preparedLocalModels = prepareLocalModelsInputs(
    localModels,
    version,
    () => USER_CONFIG_DEFAULTS.localModels
  );
  const {
    managed,
    embeddings: embeddingsDaemon,
    mode: localModelsMode,
    url: localModelsUrl
  } = preparedLocalModels;
  let llmBlock = obj.llm === void 0 || obj.llm === null ? void 0 : parseUserLlmFileConfig(obj.llm, {
    activeTextProvider: "local-llama",
    activeEmbeddingProvider: "local-llama",
    toolTransport: "auto",
    providers: [
      {
        id: "local-llama",
        kind: "llama-server",
        url: localModelsMode === "managed" ? `http://127.0.0.1:${managed.port}` : localModelsUrl,
        baseUrl: embeddingsDaemon.url
      }
    ]
  });
  if (version < 75 && llmBlock) {
    llmBlock = {
      ...llmBlock,
      providers: llmBlock.providers.map((provider) => provider.modelMode === void 0 && defaultProviderModelMode(provider) === "cloud" ? { ...provider, modelMode: "cloud" } : provider)
    };
  }
  return {
    // Spread first so a known key can never be shadowed by a stray one.
    ...unknownTopLevelKeys(obj),
    // A file from a newer build keeps its own version. Stamping ours here
    // is what turns "read a newer file" into "silently downgrade it".
    version: Math.max(version, USER_CONFIG_VERSION),
    localModels: parseUserLocalModelsConfig(
      preparedLocalModels,
      () => USER_CONFIG_DEFAULTS.localModels
    ),
    log: {
      level: parseLogLevel(
        log.level ?? USER_CONFIG_DEFAULTS.log.level,
        "log.level"
      )
    },
    agent: parseAgentConfig(agent, () => USER_CONFIG_DEFAULTS.agent),
    http: parseHttpConfig(http, version, () => USER_CONFIG_DEFAULTS.http),
    web: {
      search: parseWebSearchConfig(
        webSearchInputs,
        () => USER_CONFIG_DEFAULTS.web.search
      ),
      fetch: parseWebFetchConfig(
        webFetch,
        () => USER_CONFIG_DEFAULTS.web.fetch
      )
    },
    projects: parseProjectsConfig(projects, () => USER_CONFIG_DEFAULTS.projects),
    tools: parseToolsConfig(toolsShell, () => USER_CONFIG_DEFAULTS.tools, toolsScreen),
    browser: parseBrowserConfig(browser, () => USER_CONFIG_DEFAULTS.browser),
    sessions: parseSessionConfig(sessionsRetention, () => USER_CONFIG_DEFAULTS.sessions),
    tracing: parseTracingConfig(mergedTrace, () => USER_CONFIG_DEFAULTS.tracing),
    memory: parseMemoryConfig(
      preparedMemory,
      version,
      () => USER_CONFIG_DEFAULTS.memory
    ),
    webhooks,
    vision: parseVisionConfig(vision, () => USER_CONFIG_DEFAULTS.vision),
    skills: parseSkillsConfig(skills, () => USER_CONFIG_DEFAULTS.skills),
    tui: parseTuiConfig(tui, () => USER_CONFIG_DEFAULTS.tui),
    analytics: {
      enabled: parseBool(
        analytics.enabled ?? USER_CONFIG_DEFAULTS.analytics.enabled,
        "analytics.enabled"
      )
    },
    telegram: parseTelegramConfig(telegram, () => USER_CONFIG_DEFAULTS.telegram),
    discord: parseDiscordConfig(discord, () => USER_CONFIG_DEFAULTS.discord),
    swarm: parseSwarmConfig(swarm),
    notifications: parseNotificationsConfig(
      notificationsDownloads,
      () => USER_CONFIG_DEFAULTS.notifications
    ),
    atomicMail: parseAtomicMailConfig(atomicMail),
    git: parseGitConfig(git, () => USER_CONFIG_DEFAULTS.git),
    composio: parseComposioConfig(composio, () => USER_CONFIG_DEFAULTS.composio),
    mcp: {
      servers: parseMcpServers(mcp.servers, "mcp.servers")
    },
    ...llmBlock !== void 0 ? { llm: llmBlock } : {}
  };
}
function parseTuiNotify(raw) {
  return parseTuiNotifyWithDefaults(raw, () => USER_CONFIG_DEFAULTS.tui.notify);
}
function parseOnboardingState(raw) {
  return parseOnboardingStateWithDefaults(raw, () => USER_CONFIG_DEFAULTS.tui.onboarding);
}
export {
  CONVERSATION_MAX_PAIRS_MAX,
  CONVERSATION_MAX_PAIRS_MIN,
  ConfigValidationError,
  DEFAULT_SKILLS_CATALOG_BUDGET2 as DEFAULT_SKILLS_CATALOG_BUDGET,
  ENV_DEFAULTS,
  READ_SCOPES,
  SWARM_UNIT_ID,
  USER_CONFIG_DEFAULTS,
  USER_CONFIG_VERSION,
  parseApprovalLevel,
  parseBackendVariant,
  parseBool2 as parseBool,
  parseBoolOrNull,
  parseBoundedPositiveInt,
  parseBrowserChannel,
  parseClawHubConfig,
  parseDiscordOwnerUserIds,
  parseDownloadNotifyChannel,
  parseHalfOpenUnitInterval,
  parseHttpApprovalMode,
  parseLocalCompletionCap,
  parseLocalLlmMode,
  parseLocalTemplateSetting,
  parseLogLevel,
  parseMcpServers2 as parseMcpServers,
  parseNonEmptyString,
  parseNonNegativeBoundedInt,
  parseNonNegativeInt,
  parseOnboardingState,
  parsePositiveInt,
  parseReadScope,
  parseReasoningBudgetTokens,
  parseRewriterGateMode,
  parseSessionRailConfig,
  parseSkillNameArray,
  parseSkillTapArray,
  parseStringArrayOrNull,
  parseSwaFullPreference,
  parseTelegramOwnerId,
  parseTensorSplit,
  parseThemeName,
  parseTimestampOrNull,
  parseTuiNotify,
  parseUnitInterval,
  parseUrl,
  parseUserConfigFile,
  parseWebSearchFallback,
  parseWebSearchProviderName,
  parseWebhookMap2 as parseWebhookMap,
  parseWhileBusySubmit
};
