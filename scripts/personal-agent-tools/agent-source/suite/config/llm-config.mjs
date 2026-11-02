import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseModelMode, parseModelModes } from "./model-mode.mjs";
import {
  parseLlmRunModeConfig
} from "./llm-run-mode-config.mjs";
import { SUBSCRIPTION_CLI_KIND } from "./provider-auth-mode.mjs";
const SUBSCRIPTION_CLIS = ["claude", "codex"];
const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const PROVIDER_KINDS = /* @__PURE__ */ new Set([
  "llama-server",
  "openai-compatible",
  "qwen-openai-compatible",
  "openrouter",
  "aimlapi",
  "gemini",
  SUBSCRIPTION_CLI_KIND
]);
function parseProviderId(raw, field) {
  if (typeof raw !== "string" || !PROVIDER_ID_RE.test(raw)) {
    throw new ConfigValidationError(
      field,
      `expected kebab-case id matching ${PROVIDER_ID_RE.source}`
    );
  }
  return raw;
}
function parseOptionalString(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigValidationError(field, "expected non-empty string");
  }
  return raw;
}
function parseOptionalHeaders(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new ConfigValidationError(`${field}.${key}`, "expected string");
    }
    out[key] = value;
  }
  return out;
}
function parseLlmProviderEntry(raw, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const id = parseProviderId(obj.id, `${field}.id`);
  const kind = parseOptionalString(obj.kind, `${field}.kind`);
  if (!kind || !PROVIDER_KINDS.has(kind)) {
    throw new ConfigValidationError(
      `${field}.kind`,
      `expected one of ${[...PROVIDER_KINDS].join(", ")}`
    );
  }
  const subscriptionCli = parseSubscriptionCliOptions(
    obj.subscriptionCli,
    `${field}.subscriptionCli`
  );
  if (kind === SUBSCRIPTION_CLI_KIND && !subscriptionCli) {
    throw new ConfigValidationError(
      `${field}.subscriptionCli`,
      `required when kind is ${SUBSCRIPTION_CLI_KIND}`
    );
  }
  return {
    id,
    kind,
    ...obj.modelMode == null ? {} : { modelMode: parseModelMode(obj.modelMode, `${field}.modelMode`) },
    ...obj.modelModes == null ? {} : { modelModes: parseModelModes(obj.modelModes, `${field}.modelModes`) },
    url: parseOptionalString(obj.url, `${field}.url`),
    apiKey: parseOptionalString(obj.apiKey, `${field}.apiKey`),
    model: parseOptionalString(obj.model, `${field}.model`),
    baseUrl: parseOptionalString(obj.baseUrl, `${field}.baseUrl`),
    apiKeyEnvVar: parseOptionalString(
      obj.apiKeyEnvVar,
      `${field}.apiKeyEnvVar`
    ),
    defaultChatModel: parseOptionalString(
      obj.defaultChatModel,
      `${field}.defaultChatModel`
    ),
    defaultEmbeddingModel: parseOptionalString(
      obj.defaultEmbeddingModel,
      `${field}.defaultEmbeddingModel`
    ),
    headers: parseOptionalHeaders(obj.headers, `${field}.headers`),
    apiKeyHeader: parseOptionalString(
      obj.apiKeyHeader,
      `${field}.apiKeyHeader`
    ),
    supportsTools: obj.supportsTools === void 0 ? void 0 : typeof obj.supportsTools === "boolean" ? obj.supportsTools : (() => {
      throw new ConfigValidationError(
        `${field}.supportsTools`,
        "expected boolean"
      );
    })(),
    supportsVision: obj.supportsVision === void 0 ? void 0 : typeof obj.supportsVision === "boolean" ? obj.supportsVision : (() => {
      throw new ConfigValidationError(
        `${field}.supportsVision`,
        "expected boolean"
      );
    })(),
    requestTimeoutMs: obj.requestTimeoutMs === void 0 ? void 0 : typeof obj.requestTimeoutMs === "number" && Number.isFinite(obj.requestTimeoutMs) && obj.requestTimeoutMs > 0 ? Math.floor(obj.requestTimeoutMs) : (() => {
      throw new ConfigValidationError(
        `${field}.requestTimeoutMs`,
        "expected positive number"
      );
    })(),
    maxOutputTokens: obj.maxOutputTokens === void 0 ? void 0 : typeof obj.maxOutputTokens === "number" && Number.isInteger(obj.maxOutputTokens) && obj.maxOutputTokens > 0 ? obj.maxOutputTokens : (() => {
      throw new ConfigValidationError(
        `${field}.maxOutputTokens`,
        "expected positive integer"
      );
    })(),
    promptCache: parseOptionalEnum(obj.promptCache, `${field}.promptCache`, PROMPT_CACHE_MODES),
    messageShape: parseOptionalEnum(obj.messageShape, `${field}.messageShape`, MESSAGE_SHAPES),
    providerPreferences: parseOptionalPlainObject(
      obj.providerPreferences,
      `${field}.providerPreferences`
    ),
    extraBody: parseOptionalPlainObject(obj.extraBody, `${field}.extraBody`),
    strictTools: obj.strictTools === void 0 ? void 0 : typeof obj.strictTools === "boolean" ? obj.strictTools : (() => {
      throw new ConfigValidationError(
        `${field}.strictTools`,
        "expected boolean"
      );
    })(),
    userModels: parseOptionalUserModels(obj.userModels, `${field}.userModels`),
    subscriptionCli: parseSubscriptionCliOptions(
      obj.subscriptionCli,
      `${field}.subscriptionCli`
    )
  };
}
function parseSubscriptionCliOptions(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const cli = obj.cli;
  if (typeof cli !== "string" || !SUBSCRIPTION_CLIS.includes(cli)) {
    throw new ConfigValidationError(
      `${field}.cli`,
      `expected one of ${SUBSCRIPTION_CLIS.join(", ")}`
    );
  }
  const out = { cli };
  const binPath = parseOptionalString(obj.binPath, `${field}.binPath`);
  if (binPath !== void 0) out.binPath = binPath;
  if (obj.extraArgs !== void 0 && obj.extraArgs !== null) {
    if (!Array.isArray(obj.extraArgs)) {
      throw new ConfigValidationError(
        `${field}.extraArgs`,
        "expected array of strings"
      );
    }
    out.extraArgs = obj.extraArgs.map((value, i) => {
      if (typeof value !== "string") {
        throw new ConfigValidationError(
          `${field}.extraArgs[${i}]`,
          "expected string"
        );
      }
      return value;
    });
  }
  if (obj.streaming !== void 0 && obj.streaming !== null) {
    if (typeof obj.streaming !== "boolean") {
      throw new ConfigValidationError(`${field}.streaming`, "expected boolean");
    }
    out.streaming = obj.streaming;
  }
  if (obj.maxBudgetUsd !== void 0 && obj.maxBudgetUsd !== null) {
    if (typeof obj.maxBudgetUsd !== "number" || !Number.isFinite(obj.maxBudgetUsd) || obj.maxBudgetUsd <= 0) {
      throw new ConfigValidationError(
        `${field}.maxBudgetUsd`,
        "expected positive number"
      );
    }
    out.maxBudgetUsd = obj.maxBudgetUsd;
  }
  return out;
}
function parseOptionalPlainObject(raw, field) {
  if (raw === void 0) return void 0;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  return { ...raw };
}
const PROMPT_CACHE_MODES = /* @__PURE__ */ new Set(["auto", "off", "explicit-markers"]);
const MESSAGE_SHAPES = /* @__PURE__ */ new Set(["native", "flat"]);
const TOOLS_SUPPORT_LEVELS = /* @__PURE__ */ new Set(["none", "basic", "parallel", "strict"]);
const REASONING_FORMATS = /* @__PURE__ */ new Set([
  "auto",
  "none",
  "delta_reasoning",
  "delta_thinking",
  "delta_reasoning_content"
]);
function parseOptionalBoolean(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "boolean") {
    throw new ConfigValidationError(field, "expected boolean");
  }
  return raw;
}
function parseOptionalEnum(raw, field, allowed) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string" || !allowed.has(raw)) {
    throw new ConfigValidationError(
      field,
      `expected ${[...allowed].join("|")}`
    );
  }
  return raw;
}
function parseRate(raw, field) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new ConfigValidationError(field, "expected a non-negative number");
  }
  return raw;
}
function parseUserModelPricing(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const pricing = {
    input: parseRate(obj.input, `${field}.input`),
    output: parseRate(obj.output, `${field}.output`)
  };
  if (obj.cacheRead !== void 0 && obj.cacheRead !== null) {
    pricing.cacheRead = parseRate(obj.cacheRead, `${field}.cacheRead`);
  }
  if (obj.cacheWrite !== void 0 && obj.cacheWrite !== null) {
    pricing.cacheWrite = parseRate(obj.cacheWrite, `${field}.cacheWrite`);
  }
  return pricing;
}
function parseUserModelEntry(raw, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new ConfigValidationError(`${field}.id`, "expected non-empty string");
  }
  if (obj.kind !== "chat" && obj.kind !== "embedding") {
    throw new ConfigValidationError(`${field}.kind`, "expected chat|embedding");
  }
  return {
    id: obj.id,
    kind: obj.kind,
    contextWindow: obj.contextWindow === void 0 || obj.contextWindow === null ? void 0 : parsePositiveInt(obj.contextWindow, `${field}.contextWindow`),
    dim: obj.dim === void 0 || obj.dim === null ? void 0 : parsePositiveInt(obj.dim, `${field}.dim`),
    supportsVision: parseOptionalBoolean(
      obj.supportsVision,
      `${field}.supportsVision`
    ),
    supportsTools: parseOptionalEnum(obj.supportsTools, `${field}.supportsTools`, TOOLS_SUPPORT_LEVELS),
    supportsPromptCache: parseOptionalBoolean(
      obj.supportsPromptCache,
      `${field}.supportsPromptCache`
    ),
    reasoningFormat: parseOptionalEnum(obj.reasoningFormat, `${field}.reasoningFormat`, REASONING_FORMATS),
    pricing: parseUserModelPricing(obj.pricing, `${field}.pricing`),
    params: parseOptionalPlainObject(obj.params, `${field}.params`)
  };
}
function parseOptionalUserModels(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected array");
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = parseUserModelEntry(raw[i], `${field}[${i}]`);
    if (seen.has(entry.id)) {
      throw new ConfigValidationError(
        `${field}[${i}].id`,
        `duplicate model id ${JSON.stringify(entry.id)}`
      );
    }
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
function parseLlmProviders(raw, field) {
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected array");
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = parseLlmProviderEntry(raw[i], `${field}[${i}]`);
    if (seen.has(entry.id)) {
      throw new ConfigValidationError(
        `${field}[${i}].id`,
        `duplicate provider id ${JSON.stringify(entry.id)}`
      );
    }
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}
function parsePositiveInt(raw, field) {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new ConfigValidationError(field, "expected a positive integer");
  }
  return raw;
}
function parseCooldownLadder(raw, field) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigValidationError(
      field,
      "expected a non-empty array of positive integers (ms)"
    );
  }
  const ladder = raw.map((v, i) => parsePositiveInt(v, `${field}[${i}]`));
  for (let i = 1; i < ladder.length; i++) {
    if (ladder[i] < ladder[i - 1]) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `cooldown ladder must be non-decreasing (${ladder[i]} < ${ladder[i - 1]} at the previous step)`
      );
    }
  }
  return ladder;
}
function parseLlmFallbackConfig(raw, providerIds, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const out = {};
  if (obj.chain !== void 0) {
    if (!Array.isArray(obj.chain)) {
      throw new ConfigValidationError(
        `${field}.chain`,
        "expected array of provider ids"
      );
    }
    const chain = obj.chain.map(
      (v, i) => parseProviderId(v, `${field}.chain[${i}]`)
    );
    for (let i = 0; i < chain.length; i++) {
      if (!providerIds.has(chain[i])) {
        throw new ConfigValidationError(
          `${field}.chain[${i}]`,
          `unknown provider id ${JSON.stringify(chain[i])}`
        );
      }
    }
    out.chain = chain;
  }
  if (obj.appendLocal !== void 0) {
    if (typeof obj.appendLocal !== "boolean") {
      throw new ConfigValidationError(
        `${field}.appendLocal`,
        "expected boolean"
      );
    }
    out.appendLocal = obj.appendLocal;
  }
  if (obj.failureThreshold !== void 0) {
    out.failureThreshold = parsePositiveInt(
      obj.failureThreshold,
      `${field}.failureThreshold`
    );
  }
  if (obj.cooldownMs !== void 0) {
    out.cooldownMs = parseCooldownLadder(obj.cooldownMs, `${field}.cooldownMs`);
  }
  if (obj.probeThrottleMs !== void 0) {
    out.probeThrottleMs = parsePositiveInt(
      obj.probeThrottleMs,
      `${field}.probeThrottleMs`
    );
  }
  if (obj.failureWindowMs !== void 0) {
    out.failureWindowMs = parsePositiveInt(
      obj.failureWindowMs,
      `${field}.failureWindowMs`
    );
  }
  return out;
}
function parseUserLlmFileConfig(raw, defaults) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError("llm", "expected object");
  }
  const obj = raw;
  const providers = parseLlmProviders(
    obj.providers ?? defaults.providers,
    "llm.providers"
  );
  const activeTextProvider = parseProviderId(
    obj.activeTextProvider ?? defaults.activeTextProvider,
    "llm.activeTextProvider"
  );
  let activeEmbeddingProvider = parseProviderId(
    obj.activeEmbeddingProvider ?? defaults.activeEmbeddingProvider,
    "llm.activeEmbeddingProvider"
  );
  if (!providers.some((p) => p.id === activeTextProvider)) {
    throw new ConfigValidationError(
      "llm.activeTextProvider",
      `unknown provider id ${JSON.stringify(activeTextProvider)}`
    );
  }
  if ((obj.activeEmbeddingProvider === void 0 || obj.activeEmbeddingProvider === null) && !providers.some((p) => p.id === activeEmbeddingProvider)) {
    activeEmbeddingProvider = providers.find(
      (p) => p.defaultEmbeddingModel || p.kind === "llama-server"
    )?.id ?? activeTextProvider;
  }
  if (!providers.some((p) => p.id === activeEmbeddingProvider)) {
    throw new ConfigValidationError(
      "llm.activeEmbeddingProvider",
      `unknown provider id ${JSON.stringify(activeEmbeddingProvider)}`
    );
  }
  const toolTransportRaw = obj.toolTransport ?? defaults.toolTransport;
  if (toolTransportRaw !== "auto" && toolTransportRaw !== "grammar" && toolTransportRaw !== "native_tools") {
    throw new ConfigValidationError(
      "llm.toolTransport",
      "expected auto|grammar|native_tools"
    );
  }
  const fallback = obj.fallback === void 0 || obj.fallback === null ? void 0 : parseLlmFallbackConfig(
    obj.fallback,
    new Set(providers.map((p) => p.id)),
    "llm.fallback"
  );
  const runMode = obj.runMode === void 0 || obj.runMode === null ? void 0 : parseLlmRunModeConfig(obj.runMode, providers, "llm.runMode");
  const openrouter = parseLlmOpenRouterConfig(obj.openrouter, "llm.openrouter");
  return {
    activeTextProvider,
    activeEmbeddingProvider,
    toolTransport: toolTransportRaw,
    providers,
    ...fallback ? { fallback } : {},
    ...runMode ? { runMode } : {},
    ...openrouter ? { openrouter } : {}
  };
}
function parseLlmOpenRouterConfig(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const preferCacheRoutes = parseOptionalBoolean(
    obj.preferCacheRoutes,
    `${field}.preferCacheRoutes`
  );
  return preferCacheRoutes === void 0 ? {} : { preferCacheRoutes };
}
export {
  SUBSCRIPTION_CLIS,
  parseLlmFallbackConfig,
  parseLlmOpenRouterConfig,
  parseLlmProviderEntry,
  parseLlmProviders,
  parseUserLlmFileConfig
};
