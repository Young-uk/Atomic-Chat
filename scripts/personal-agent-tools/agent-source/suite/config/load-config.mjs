import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV_DEFAULTS
} from "./config-schema.mjs";
import { ensureUserConfigFileSync, getUserConfigPath } from "./config-file.mjs";
import { setCustomLocalModels } from "../local-llm/catalog/models-catalog.mjs";
import { setDefaultDownloadConnections } from "../local-llm/downloads/download-settings.mjs";
import { setDefaultHuggingFaceEndpoint } from "../local-llm/catalog/huggingface-endpoint.mjs";
import {
  setConfiguredBackendVariant,
  setConfiguredCoreBackendVariant
} from "../local-llm/backend/windows-backend-variant.mjs";
import { resolveLocalLlamaApiKey } from "../local-llm/server/managed-api-key.mjs";
import { loadDotenvFromStateDir } from "./load-dotenv.mjs";
import { resolveLlmProviderApiKey } from "./resolve-llm-api-key.mjs";
function readEnv(key) {
  const value = process.env[key];
  return value && value.length > 0 ? value : void 0;
}
function readInt(key, fallback) {
  const raw = readEnv(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function readBoundedPositiveInt(key, fallback, min, max) {
  const raw = readEnv(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
function readBool(key, fallback) {
  const raw = readEnv(key);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
function readBrowserChannel(key, fallback) {
  const raw = readEnv(key)?.toLowerCase();
  if (raw === "chrome" || raw === "msedge" || raw === "chromium") return raw;
  return fallback;
}
function resolvePath(raw, fallback) {
  const value = raw ?? fallback;
  if (value.startsWith("~")) {
    return resolve(homedir(), value.slice(2));
  }
  if (isAbsolute(value)) return value;
  return resolve(process.cwd(), value);
}
function resolveAssetDir(envKey, relativeDefault) {
  const raw = readEnv(envKey);
  if (raw) {
    return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  }
  const nextToBinary = resolve(dirname(process.execPath), relativeDefault);
  if (existsSync(nextToBinary)) {
    return nextToBinary;
  }
  const nextToModule = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    relativeDefault
  );
  if (existsSync(nextToModule)) {
    return nextToModule;
  }
  return resolve(process.cwd(), relativeDefault);
}
function resolveStateDir() {
  return resolvePath(readEnv("ATOMIC_AGENT_STATE_DIR"), ENV_DEFAULTS.STATE_DIR);
}
function loadConfig() {
  const stateDir = resolveStateDir();
  const dotenv = loadDotenvFromStateDir(stateDir);
  const userConfigFile = getUserConfigPath(stateDir);
  const user = ensureUserConfigFileSync(userConfigFile);
  setCustomLocalModels(user.localModels.customModels);
  setConfiguredBackendVariant(user.localModels.managed.backendVariant);
  setConfiguredCoreBackendVariant(user.localModels.managed.coreBackendVariant);
  setDefaultDownloadConnections(user.localModels.download.connections);
  setDefaultHuggingFaceEndpoint(user.localModels.download.hfEndpoint);
  const grammarsDir = resolveAssetDir("ATOMIC_AGENT_GRAMMARS_DIR", "grammars");
  const browserChannel = readBrowserChannel(
    "ATOMIC_AGENT_BROWSER_CHANNEL",
    ENV_DEFAULTS.BROWSER_CHANNEL
  );
  const logLevel = user.log.level;
  const localModelsDataDir = resolvePath(
    user.localModels.managed.dataDirOverride ?? void 0,
    resolve(stateDir, "models")
  );
  const resolvedLocalLlmUrl = user.localModels.mode === "managed" ? `http://127.0.0.1:${user.localModels.managed.port}` : user.localModels.url;
  return {
    dotenv,
    localModels: {
      url: resolvedLocalLlmUrl,
      // The operator's key, else the managed daemons' key (persisted next
      // to their pid file) whenever the agent talks to them — so every
      // client, in this process or the next, sends what the server
      // requires (#582). See `resolveLocalLlamaApiKey`.
      apiKey: resolveLocalLlamaApiKey({
        envKey: readEnv("ATOMIC_AGENT_LLAMA_API_KEY"),
        mode: user.localModels.mode,
        chatUrl: resolvedLocalLlmUrl,
        managedPorts: [
          user.localModels.managed.port,
          user.localModels.embeddings.port
        ],
        dataDir: localModelsDataDir
      }),
      healthPath: "/health",
      completionPath: "/completion",
      completionMaxTokens: readBoundedPositiveInt(
        "ATOMIC_AGENT_LLAMA_MAX_TOKENS",
        user.localModels.completionMaxTokens,
        64,
        131072
      ),
      healthTimeoutMs: readInt(
        "ATOMIC_AGENT_LLAMA_HEALTH_TIMEOUT_MS",
        ENV_DEFAULTS.HEALTH_TIMEOUT_MS
      ),
      requestTimeoutMs: readInt(
        "ATOMIC_AGENT_LLAMA_REQUEST_TIMEOUT_MS",
        ENV_DEFAULTS.REQUEST_TIMEOUT_MS
      ),
      firstTokenTimeoutMs: readInt(
        "ATOMIC_AGENT_LLAMA_FIRST_TOKEN_TIMEOUT_MS",
        ENV_DEFAULTS.FIRST_TOKEN_TIMEOUT_MS
      ),
      streamTotalTimeoutMs: readInt(
        "ATOMIC_AGENT_LLAMA_STREAM_TOTAL_TIMEOUT_MS",
        ENV_DEFAULTS.STREAM_TOTAL_TIMEOUT_MS
      ),
      healthRetries: readInt(
        "ATOMIC_AGENT_LLAMA_HEALTH_RETRIES",
        ENV_DEFAULTS.HEALTH_RETRIES
      ),
      healthRetryBackoffMs: readInt(
        "ATOMIC_AGENT_LLAMA_HEALTH_BACKOFF_MS",
        ENV_DEFAULTS.HEALTH_BACKOFF_MS
      ),
      completionRetries: readInt(
        "ATOMIC_AGENT_LLAMA_COMPLETION_RETRIES",
        ENV_DEFAULTS.COMPLETION_RETRIES
      ),
      completionRetryBackoffMs: readInt(
        "ATOMIC_AGENT_LLAMA_COMPLETION_RETRY_BACKOFF_MS",
        ENV_DEFAULTS.COMPLETION_RETRY_BACKOFF_MS
      ),
      defaultSlotId: readInt(
        "ATOMIC_AGENT_LLAMA_DEFAULT_SLOT",
        ENV_DEFAULTS.DEFAULT_SLOT_ID
      ),
      mode: user.localModels.mode,
      useServerTemplate: user.localModels.useServerTemplate,
      thinking: user.localModels.thinking,
      reasoningBudgetTokens: user.localModels.reasoningBudgetTokens,
      drySampler: user.localModels.drySampler,
      managed: { ...user.localModels.managed },
      embeddings: { ...user.localModels.embeddings },
      download: { ...user.localModels.download }
    },
    paths: {
      stateDir,
      sessionsDbFile: resolve(stateDir, "sessions.sqlite"),
      memoryDbFile: resolve(stateDir, "memory.sqlite"),
      tasksDbFile: resolve(stateDir, "tasks.sqlite"),
      tracesDir: resolve(stateDir, "traces"),
      grammarsDir,
      browserProfileDir: resolve(stateDir, "browser-profile"),
      globalSkillsDir: resolve(stateDir, "skills"),
      projectSkillsDirName: ENV_DEFAULTS.PROJECT_SKILLS_DIR,
      userConfigFile,
      localModelsDataDir
    },
    agent: {
      tokenBudget: user.agent.tokenBudget,
      maxSteps: user.agent.maxSteps,
      providerWait: user.agent.providerWait,
      task: user.agent.task,
      toolTimeoutMs: user.agent.toolTimeoutMs,
      readScope: user.agent.readScope,
      approvalLevel: user.agent.approvalLevel,
      stablePrefixHashSalt: readEnv("ATOMIC_AGENT_STABLE_PREFIX_SALT") ?? ENV_DEFAULTS.STABLE_PREFIX_SALT,
      compaction: user.agent.compaction,
      conversationMaxTokens: user.agent.conversationMaxTokens,
      conversationMaxPairs: user.agent.conversationMaxPairs,
      nameSessions: user.agent.nameSessions,
      conversationLowWater: user.agent.conversationLowWater,
      sessionSectionsMaxTokens: user.agent.sessionSectionsMaxTokens,
      worldSnapshotMaxTokens: user.agent.worldSnapshotMaxTokens,
      loadedToolsCap: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOADED_TOOLS_CAP",
        ENV_DEFAULTS.LOADED_TOOLS_CAP,
        1,
        64
      ),
      loadedToolsMaxTokens: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOADED_TOOLS_MAX_TOKENS",
        ENV_DEFAULTS.LOADED_TOOLS_MAX_TOKENS,
        0,
        8e3
      ),
      autoExpandRareOnError: readBool(
        "ATOMIC_AGENT_AUTO_EXPAND_RARE_ON_ERROR",
        ENV_DEFAULTS.AUTO_EXPAND_RARE_ON_ERROR
      ),
      maxParallelToolCalls: readBoundedPositiveInt(
        "ATOMIC_AGENT_MAX_PARALLEL_TOOL_CALLS",
        ENV_DEFAULTS.MAX_PARALLEL_TOOL_CALLS,
        1,
        16
      ),
      batchToolResultCharCap: readBoundedPositiveInt(
        "ATOMIC_AGENT_BATCH_TOOL_RESULT_CHAR_CAP",
        ENV_DEFAULTS.BATCH_TOOL_RESULT_CHAR_CAP,
        1e3,
        1e6
      ),
      // Lower bounds are the compressor's own defaults, so an operator
      // dialling down can land exactly on the pre-knob behaviour.
      shellToolResultCharCap: readBoundedPositiveInt(
        "ATOMIC_AGENT_SHELL_TOOL_RESULT_CHAR_CAP",
        ENV_DEFAULTS.SHELL_TOOL_RESULT_CHAR_CAP,
        400,
        1e6
      ),
      shellToolResultTailLines: readBoundedPositiveInt(
        "ATOMIC_AGENT_SHELL_TOOL_RESULT_TAIL_LINES",
        ENV_DEFAULTS.SHELL_TOOL_RESULT_TAIL_LINES,
        12,
        1e5
      ),
      loopWarningThreshold: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_WARNING_THRESHOLD",
        ENV_DEFAULTS.LOOP_WARNING_THRESHOLD,
        2,
        100
      ),
      loopCriticalThreshold: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_CRITICAL_THRESHOLD",
        ENV_DEFAULTS.LOOP_CRITICAL_THRESHOLD,
        3,
        100
      ),
      loopBreakerVetoStreak: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_BREAKER_VETO_STREAK",
        ENV_DEFAULTS.LOOP_BREAKER_VETO_STREAK,
        1,
        100
      ),
      loopHistorySize: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_HISTORY_SIZE",
        ENV_DEFAULTS.LOOP_HISTORY_SIZE,
        5,
        1e3
      ),
      loopWanderingThreshold: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_WANDERING_THRESHOLD",
        ENV_DEFAULTS.LOOP_WANDERING_THRESHOLD,
        2,
        100
      ),
      loopWanderingEscalation: readBoundedPositiveInt(
        "ATOMIC_AGENT_LOOP_WANDERING_ESCALATION",
        ENV_DEFAULTS.LOOP_WANDERING_ESCALATION,
        2,
        1e3
      )
    },
    browser: {
      enabled: readBool(
        "ATOMIC_AGENT_BROWSER_ENABLED",
        ENV_DEFAULTS.BROWSER_ENABLED
      ),
      channel: browserChannel,
      headless: readBool(
        "ATOMIC_AGENT_BROWSER_HEADLESS",
        ENV_DEFAULTS.BROWSER_HEADLESS
      ),
      // Env wins over the file, as before the file key existed. Only the
      // file value is held to loopback (browser-config.ts): the env var
      // is the operator's own shell, the file can be written over HTTP.
      cdpUrl: readEnv("ATOMIC_AGENT_BROWSER_CDP_URL") ?? user.browser.cdpUrl,
      connect: user.browser.connect,
      userChromeDataDir: user.browser.userDataDir === null ? null : resolvePath(user.browser.userDataDir, user.browser.userDataDir),
      executablePath: readEnv("ATOMIC_AGENT_BROWSER_EXECUTABLE_PATH") ?? null,
      noSandbox: readBool(
        "ATOMIC_AGENT_BROWSER_NO_SANDBOX",
        ENV_DEFAULTS.BROWSER_NO_SANDBOX
      ),
      launchTimeoutMs: readInt(
        "ATOMIC_AGENT_BROWSER_LAUNCH_TIMEOUT_MS",
        ENV_DEFAULTS.BROWSER_LAUNCH_TIMEOUT_MS
      ),
      blockedDomains: [...user.browser.blockedDomains],
      allowedDomains: [...user.browser.allowedDomains]
    },
    skills: {
      // File value is the default, env var overrides it — the same
      // layering `localModels.completionMaxTokens` uses. Before v70 the
      // fallback was the schema constant, so `skills.catalogTokenBudget`
      // in config.json was read, validated and then ignored (issue #466).
      catalogTokenBudget: readBoundedPositiveInt(
        "ATOMIC_AGENT_SKILLS_CATALOG_BUDGET",
        user.skills.catalogTokenBudget,
        1,
        1e5
      ),
      disabled: user.skills.disabled,
      cloudWorkspaces: user.skills.cloudWorkspaces,
      projectTrust: user.skills.projectTrust,
      taps: user.skills.taps,
      clawhub: user.skills.clawhub
    },
    http: {
      enabled: user.http.enabled,
      approvalMode: user.http.approvalMode,
      hostAllowlist: user.http.hostAllowlist,
      maxResponseBytes: user.http.maxResponseBytes,
      defaultTimeoutMs: user.http.defaultTimeoutMs
    },
    web: {
      search: { ...user.web.search },
      fetch: { ...user.web.fetch }
    },
    projects: {
      roots: [...user.projects.roots]
    },
    tools: {
      shell: {
        defaultTimeoutMs: user.tools.shell.defaultTimeoutMs,
        jobMaxMs: user.tools.shell.jobMaxMs,
        maxJobs: user.tools.shell.maxJobs,
        envPassthrough: [...user.tools.shell.envPassthrough]
      },
      screen: { enabled: user.tools.screen.enabled }
    },
    log: { level: logLevel },
    tasks: {
      enabled: readBool(
        "ATOMIC_AGENT_TASKS_ENABLED",
        ENV_DEFAULTS.TASKS_ENABLED
      ),
      maxAttempts: readInt(
        "ATOMIC_AGENT_TASKS_MAX_ATTEMPTS",
        ENV_DEFAULTS.TASKS_MAX_ATTEMPTS
      ),
      backoffInitialMs: readInt(
        "ATOMIC_AGENT_TASKS_BACKOFF_INITIAL_MS",
        ENV_DEFAULTS.TASKS_BACKOFF_INITIAL_MS
      ),
      backoffMaxMs: readInt(
        "ATOMIC_AGENT_TASKS_BACKOFF_MAX_MS",
        ENV_DEFAULTS.TASKS_BACKOFF_MAX_MS
      ),
      runOnCreate: readBool(
        "ATOMIC_AGENT_TASKS_RUN_ON_CREATE",
        ENV_DEFAULTS.TASKS_RUN_ON_CREATE
      ),
      staleAfterMs: readInt(
        "ATOMIC_AGENT_TASKS_STALE_AFTER_MS",
        ENV_DEFAULTS.TASKS_STALE_AFTER_MS
      ),
      schedulerEnabled: readBool(
        "ATOMIC_AGENT_TASKS_SCHEDULER_ENABLED",
        ENV_DEFAULTS.TASKS_SCHEDULER_ENABLED
      ),
      schedulerTickMs: readInt(
        "ATOMIC_AGENT_TASKS_SCHEDULER_TICK_MS",
        ENV_DEFAULTS.TASKS_SCHEDULER_TICK_MS
      ),
      schedulerBatch: readInt(
        "ATOMIC_AGENT_TASKS_SCHEDULER_BATCH",
        ENV_DEFAULTS.TASKS_SCHEDULER_BATCH
      ),
      agentToolsEnabled: readBool(
        "ATOMIC_AGENT_TASKS_AGENT_TOOLS_ENABLED",
        ENV_DEFAULTS.TASKS_AGENT_TOOLS_ENABLED
      ),
      minIntervalMs: readInt(
        "ATOMIC_AGENT_TASKS_MIN_INTERVAL_MS",
        ENV_DEFAULTS.TASKS_MIN_INTERVAL_MS
      )
    },
    update: {
      checkOnStartup: readBool(
        "ATOMIC_AGENT_UPDATE_CHECK_ON_STARTUP",
        ENV_DEFAULTS.UPDATE_CHECK_ON_STARTUP
      ),
      repo: readEnv("ATOMIC_AGENT_REPO") ?? ENV_DEFAULTS.UPDATE_REPO
    },
    sessions: {
      retention: {
        enabled: user.sessions.retention.enabled,
        maxAgeDays: user.sessions.retention.maxAgeDays,
        maxRows: user.sessions.retention.maxRows
      }
    },
    tracing: {
      trace: {
        enabled: user.tracing.trace.enabled,
        dir: resolve(stateDir, "traces"),
        maxBytesPerSession: user.tracing.trace.maxBytesPerSession
      }
    },
    memory: {
      profile: {
        enabled: user.memory.profile.enabled,
        maxTokens: user.memory.profile.maxTokens,
        contextualKeywordGate: user.memory.profile.contextualKeywordGate,
        maxEntries: user.memory.profile.maxEntries
      },
      reflection: {
        enabled: user.memory.reflection.enabled,
        timeoutMs: user.memory.reflection.timeoutMs,
        maxFactsPerCall: user.memory.reflection.maxFactsPerCall,
        autoStoreNotes: user.memory.reflection.autoStoreNotes,
        maxNotesPerCall: user.memory.reflection.maxNotesPerCall,
        typedNotes: {
          enabled: user.memory.reflection.typedNotes.enabled
        },
        anySpeaker: user.memory.reflection.anySpeaker,
        segmentation: {
          enabled: user.memory.reflection.segmentation.enabled,
          triggerEveryTurns: user.memory.reflection.segmentation.triggerEveryTurns,
          windowTurns: user.memory.reflection.segmentation.windowTurns
        }
      },
      notes: {
        enabled: user.memory.notes.enabled,
        maxEntries: user.memory.notes.maxEntries,
        maxContentChars: user.memory.notes.maxContentChars,
        recallDefaultK: user.memory.notes.recallDefaultK
      },
      recallInjection: {
        enabled: user.memory.recallInjection.enabled,
        k: user.memory.recallInjection.k,
        previewChars: user.memory.recallInjection.previewChars,
        maxTokens: user.memory.recallInjection.maxTokens
      },
      index: {
        enabled: user.memory.index.enabled,
        limit: user.memory.index.limit,
        previewChars: user.memory.index.previewChars,
        maxTokens: user.memory.index.maxTokens
      },
      dedup: {
        enabled: user.memory.dedup.enabled,
        fts5Threshold: user.memory.dedup.fts5Threshold
      },
      eviction: {
        utilityWeighted: user.memory.eviction.utilityWeighted,
        maxAgeMs: user.memory.eviction.maxAgeMs
      },
      embeddings: {
        enabled: user.memory.embeddings.enabled,
        fts5Weight: user.memory.embeddings.fts5Weight,
        vectorWeight: user.memory.embeddings.vectorWeight,
        bruteForceCeiling: user.memory.embeddings.bruteForceCeiling,
        backfill: user.memory.embeddings.backfill
      },
      links: {
        enabled: user.memory.links.enabled,
        autoGenerate: user.memory.links.autoGenerate,
        expansionDepth: user.memory.links.expansionDepth,
        maxExpanded: user.memory.links.maxExpanded,
        maxLinksPerCall: user.memory.links.maxLinksPerCall,
        minCandidates: user.memory.links.minCandidates,
        generatorTimeoutMs: user.memory.links.generatorTimeoutMs
      },
      evolution: {
        enabled: user.memory.evolution.enabled,
        maxPerWrite: user.memory.evolution.maxPerWrite,
        leaseMs: user.memory.evolution.leaseMs
      },
      lessons: {
        enabled: user.memory.lessons.enabled,
        recallK: user.memory.lessons.recallK,
        maxTokens: user.memory.lessons.maxTokens,
        indexLimit: user.memory.lessons.indexLimit,
        maxEntries: user.memory.lessons.maxEntries,
        deprecationAgeMs: user.memory.lessons.deprecationAgeMs
      },
      procedures: {
        enabled: user.memory.procedures.enabled,
        recallK: user.memory.procedures.recallK,
        maxTokens: user.memory.procedures.maxTokens,
        indexLimit: user.memory.procedures.indexLimit,
        maxEntries: user.memory.procedures.maxEntries,
        deprecationAgeMs: user.memory.procedures.deprecationAgeMs
      },
      consolidation: {
        enabled: user.memory.consolidation.enabled,
        intervalMs: user.memory.consolidation.intervalMs,
        cooldownMs: user.memory.consolidation.cooldownMs,
        minClusterSize: user.memory.consolidation.minClusterSize,
        maxClustersPerTick: user.memory.consolidation.maxClustersPerTick,
        requireSharedTag: user.memory.consolidation.requireSharedTag,
        distillTimeoutMs: user.memory.consolidation.distillTimeoutMs
      },
      voting: {
        enabled: user.memory.voting.enabled,
        maxVotePerItem: user.memory.voting.maxVotePerItem,
        signalDecay: user.memory.voting.signalDecay,
        scoreBlend: user.memory.voting.scoreBlend,
        eventLogMaxRows: user.memory.voting.eventLogMaxRows,
        profileFilterThreshold: user.memory.voting.profileFilterThreshold
      },
      retrieve: {
        rewriter: {
          enabled: user.memory.retrieve.rewriter.enabled,
          timeoutMs: user.memory.retrieve.rewriter.timeoutMs,
          historyTurns: user.memory.retrieve.rewriter.historyTurns,
          gateMode: user.memory.retrieve.rewriter.gateMode,
          embeddingGate: {
            threshold: user.memory.retrieve.rewriter.embeddingGate.threshold,
            exemplars: user.memory.retrieve.rewriter.embeddingGate.exemplars
          }
        }
      }
    },
    webhooks: user.webhooks,
    vision: {
      enabled: user.vision.enabled,
      autoDetect: user.vision.autoDetect,
      maxImageBytes: user.vision.maxImageBytes,
      maxImagesPerCall: user.vision.maxImagesPerCall
    },
    tui: {
      theme: user.tui.theme,
      whileBusySubmit: user.tui.whileBusySubmit,
      mouse: user.tui.mouse,
      notify: { ...user.tui.notify },
      onboarding: { ...user.tui.onboarding },
      sessionRail: {
        order: [...user.tui.sessionRail.order],
        pinned: [...user.tui.sessionRail.pinned]
      }
    },
    analytics: {
      enabled: user.analytics.enabled
    },
    telegram: {
      enabled: user.telegram.enabled,
      ownerUserId: user.telegram.ownerUserId,
      parseMode: user.telegram.parseMode,
      progressIndicator: user.telegram.progressIndicator
    },
    discord: {
      enabled: user.discord.enabled,
      ownerUserIds: user.discord.ownerUserIds
    },
    swarm: {
      units: user.swarm.units.map((u) => ({ ...u }))
    },
    notifications: {
      downloads: {
        channel: user.notifications.downloads.channel
      }
    },
    atomicMail: {
      address: user.atomicMail.address,
      accountId: user.atomicMail.accountId,
      ownerEmail: user.atomicMail.ownerEmail,
      ownerVerifiedAt: user.atomicMail.ownerVerifiedAt,
      pendingVerification: user.atomicMail.pendingVerification
    },
    git: {
      remoteSync: user.git.remoteSync
    },
    composio: {
      enabled: user.composio.enabled,
      apiKeyEnv: user.composio.apiKeyEnv,
      userId: user.composio.userId,
      sessionId: user.composio.sessionId,
      mcpUrl: user.composio.mcpUrl
    },
    mcp: {
      // Servers are owned by the user-config file. Deep clone the
      // array so downstream mutations (e.g. TUI enable/disable
      // writes) never leak back into the parsed config snapshot.
      servers: user.mcp.servers.map((s) => ({
        ...s,
        ...s.transport ? { transport: { ...s.transport } } : {},
        ...s.env ? { env: { ...s.env } } : {}
      }))
    },
    llm: user.llm ? mapUserLlmToRuntime(user.llm) : void 0
  };
}
function mapUserLlmToRuntime(llm) {
  return {
    activeTextProvider: llm.activeTextProvider,
    activeEmbeddingProvider: llm.activeEmbeddingProvider,
    toolTransport: llm.toolTransport,
    providers: llm.providers.map((entry) => {
      const apiKey = resolveLlmProviderApiKey(entry);
      return {
        ...entry,
        ...apiKey ? { apiKey } : {}
      };
    }),
    ...llm.fallback ? { fallback: llm.fallback } : {},
    ...llm.runMode ? { runMode: llm.runMode } : {},
    // Without this `llm.openrouter.preferCacheRoutes: false` never
    // reached the provider factory, which fell back to `true`.
    ...llm.openrouter ? { openrouter: { ...llm.openrouter } } : {}
  };
}
export {
  loadConfig,
  resolveStateDir
};
