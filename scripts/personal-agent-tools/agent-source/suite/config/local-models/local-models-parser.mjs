import { ConfigValidationError } from "../config-validation-error.mjs";
import {
  coerceIntLike,
  parseBool,
  parsePositiveInt,
  parseBoundedPositiveInt,
  parseNonNegativeInt,
  parseNonEmptyString,
  emitConfigNoticeOnce
} from "../config-primitives.mjs";
import { parseUrl } from "../config-values.mjs";
import { parseCustomLocalModels } from "../custom-models-schema.mjs";
import { isKnownLocalModelId } from "../../local-llm/catalog/models-catalog.mjs";
import {
  BACKEND_VARIANT_PREFERENCES,
  CORE_BACKEND_VARIANTS,
  isBackendVariantPreference,
  isCoreBackendVariant
} from "../../local-llm/backend/windows-backend-variant.mjs";
import { MAX_DOWNLOAD_CONNECTIONS } from "../../local-llm/downloads/download-settings.mjs";
import { normalizeHuggingFaceEndpoint } from "../../local-llm/catalog/huggingface-endpoint.mjs";
import {
  isSwaFullPreference,
  SWA_FULL_PREFERENCES
} from "../../local-llm/server/swa-full.mjs";
const MANAGED_AUTO_UPDATE_DEFAULTS_VERSION = 41;
const UNCHOSEN_PARALLEL = 2;
const AUTO_PARALLEL_VERSION = 63;
const ATOMIC_CORE_DEFAULT_VERSION = 77;
const UNBOUNDED_REASONING_DEFAULT_VERSION = 78;
const UNCHOSEN_REASONING_BUDGET_TOKENS = 1500;
function parseLocalTemplateSetting(raw, field) {
  if (raw === "auto" || raw === "on" || raw === "off") return raw;
  throw new ConfigValidationError(
    field,
    `expected auto|on|off, got ${JSON.stringify(raw)}`
  );
}
function parseLocalLlmMode(raw, field) {
  if (raw === "external" || raw === "managed") return raw;
  throw new ConfigValidationError(
    field,
    `expected external|managed, got ${JSON.stringify(raw)}`
  );
}
function parseBackendVariant(raw, field) {
  if (isBackendVariantPreference(raw)) return raw;
  throw new ConfigValidationError(
    field,
    `expected ${BACKEND_VARIANT_PREFERENCES.join("|")}, got ${JSON.stringify(raw)}`
  );
}
function parseCoreBackendVariant(raw, field) {
  if (isCoreBackendVariant(raw)) return raw;
  throw new ConfigValidationError(
    field,
    `expected ${CORE_BACKEND_VARIANTS.join("|")}, got ${JSON.stringify(raw)}`
  );
}
function parseSwaFullPreference(raw, field) {
  if (isSwaFullPreference(raw)) return raw;
  throw new ConfigValidationError(
    field,
    `expected ${SWA_FULL_PREFERENCES.join("|")}, got ${JSON.stringify(raw)}`
  );
}
function parseLocalCompletionCap(raw, field) {
  const value = coerceIntLike(raw);
  if (value === 0) return 0;
  return parseBoundedPositiveInt(raw, field, 64, 131072);
}
function parseReasoningBudgetTokens(raw, field) {
  const value = coerceIntLike(raw);
  if (value === 0) return 0;
  return parseBoundedPositiveInt(raw, field, 64, 32768);
}
function resolveReasoningBudgetTokens(inputVersion, raw, readDefaults) {
  const field = "localModels.reasoningBudgetTokens";
  const value = parseReasoningBudgetTokens(
    raw ?? readDefaults().reasoningBudgetTokens,
    field
  );
  if (raw !== void 0 && raw !== null && inputVersion < UNBOUNDED_REASONING_DEFAULT_VERSION && value === UNCHOSEN_REASONING_BUDGET_TOKENS) {
    return 0;
  }
  return value;
}
function parseTensorSplit(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected number[], got ${JSON.stringify(raw)}`
    );
  }
  if (raw.length === 0) return [];
  if (raw.length === 1) {
    throw new ConfigValidationError(
      field,
      "expected at least two ratios (one per GPU) \u2014 a single ratio is not a split; use [] to disable"
    );
  }
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected finite non-negative number, got ${JSON.stringify(entry)}`
      );
    }
    result.push(entry);
  }
  if (!result.some((r) => r > 0)) {
    throw new ConfigValidationError(
      field,
      "expected at least one positive ratio"
    );
  }
  return result;
}
function lenientBackendVariant(raw, readDefaults) {
  if (isBackendVariantPreference(raw) || typeof raw !== "string" || raw.length === 0) {
    return parseBackendVariant(raw, "localModels.managed.backendVariant");
  }
  emitConfigNoticeOnce(`[atomic-agent] localModels.managed.backendVariant ${JSON.stringify(raw)} is not known to this build; using ${JSON.stringify(readDefaults().managed.backendVariant)}`);
  return readDefaults().managed.backendVariant;
}
function parseOptionalManagedModelId(raw, field, customModels) {
  if (raw === null || raw === void 0) return null;
  const s = parseNonEmptyString(raw, field);
  if (!isKnownLocalModelId(s) && !customModels.some((m) => m.id === s)) {
    emitConfigNoticeOnce(
      `[atomic-agent] ${field} ${JSON.stringify(s)} is a model this build does not know (a newer app may have chosen it); no local model is selected here \u2014 update atomic-agent or pick one with \`models use\``
    );
    return null;
  }
  return s;
}
function resolveManagedParallel(inputVersion, raw, readDefaults) {
  if (raw === "auto") return "auto";
  if (raw === null || raw === void 0) {
    return readDefaults().managed.parallel;
  }
  const pinned = parseBoundedPositiveInt(
    raw,
    "localModels.managed.parallel",
    1,
    8
  );
  if (inputVersion < AUTO_PARALLEL_VERSION && pinned === UNCHOSEN_PARALLEL) {
    return "auto";
  }
  return pinned;
}
function resolveManagedEngine(inputVersion, raw, readDefaults) {
  if (raw !== void 0 && raw !== "llama-server" && raw !== "atomic-core") {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new ConfigValidationError("localModels.managed.engine", "expected llama-server|atomic-core");
    }
    emitConfigNoticeOnce(`[atomic-agent] localModels.managed.engine ${JSON.stringify(raw)} is not known to this build; using its default engine`);
    return readDefaults().managed.engine ?? "atomic-core";
  }
  if (inputVersion < ATOMIC_CORE_DEFAULT_VERSION) return "atomic-core";
  return raw ?? readDefaults().managed.engine ?? "atomic-core";
}
function resolveManagedAutoUpdate(inputVersion, raw, readDefaults) {
  if (inputVersion < MANAGED_AUTO_UPDATE_DEFAULTS_VERSION) {
    return true;
  }
  return parseBool(
    raw ?? readDefaults().managed.autoUpdate,
    "localModels.managed.autoUpdate"
  );
}
function resolveEmbeddingModelId(_inputVersion, raw, readDefaults) {
  if (raw !== null && raw !== void 0) {
    return parseNonEmptyString(raw, "localModels.embeddings.modelId");
  }
  return readDefaults().embeddings.modelId;
}
function parseHfEndpoint(value, path) {
  const normalized = typeof value === "string" ? normalizeHuggingFaceEndpoint(value) : null;
  if (!normalized) {
    throw new ConfigValidationError(
      path,
      `must be an http(s) origin such as "https://hf-mirror.com", got ${JSON.stringify(value)}`
    );
  }
  return normalized;
}
function prepareLocalModelsInputs(localModels, inputVersion, readDefaults) {
  const customModels = parseCustomLocalModels(
    localModels.customModels,
    "localModels.customModels"
  );
  const rawManaged = localModels.managed ?? {};
  const managed = {
    engine: resolveManagedEngine(inputVersion, rawManaged.engine, readDefaults),
    modelId: parseOptionalManagedModelId(
      rawManaged.modelId,
      "localModels.managed.modelId",
      customModels
    ),
    port: parsePositiveInt(
      rawManaged.port ?? readDefaults().managed.port,
      "localModels.managed.port"
    ),
    dataDirOverride: rawManaged.dataDirOverride === null || rawManaged.dataDirOverride === void 0 ? null : parseNonEmptyString(
      rawManaged.dataDirOverride,
      "localModels.managed.dataDirOverride"
    ),
    autoUpdate: resolveManagedAutoUpdate(inputVersion, rawManaged.autoUpdate, readDefaults),
    stopOnExit: parseBool(
      rawManaged.stopOnExit ?? readDefaults().managed.stopOnExit,
      "localModels.managed.stopOnExit"
    ),
    autoRestart: parseBool(
      rawManaged.autoRestart ?? readDefaults().managed.autoRestart,
      "localModels.managed.autoRestart"
    ),
    device: parseNonEmptyString(
      rawManaged.device ?? readDefaults().managed.device,
      "localModels.managed.device"
    ),
    backendVariant: lenientBackendVariant(
      rawManaged.backendVariant ?? readDefaults().managed.backendVariant,
      readDefaults
    ),
    coreBackendVariant: parseCoreBackendVariant(
      rawManaged.coreBackendVariant ?? readDefaults().managed.coreBackendVariant,
      "localModels.managed.coreBackendVariant"
    ),
    contextSize: parseNonNegativeInt(
      rawManaged.contextSize ?? readDefaults().managed.contextSize,
      "localModels.managed.contextSize"
    ),
    tensorSplit: parseTensorSplit(
      rawManaged.tensorSplit,
      "localModels.managed.tensorSplit"
    ),
    parallel: resolveManagedParallel(inputVersion, rawManaged.parallel, readDefaults),
    swaFull: parseSwaFullPreference(
      rawManaged.swaFull ?? readDefaults().managed.swaFull,
      "localModels.managed.swaFull"
    )
  };
  const rawEmbeddings = localModels.embeddings ?? {};
  const embeddingsPort = parsePositiveInt(
    rawEmbeddings.port ?? readDefaults().embeddings.port,
    "localModels.embeddings.port"
  );
  const embeddingsDaemon = {
    enabled: parseBool(
      rawEmbeddings.enabled ?? readDefaults().embeddings.enabled,
      "localModels.embeddings.enabled"
    ),
    modelId: resolveEmbeddingModelId(inputVersion, rawEmbeddings.modelId, readDefaults),
    port: embeddingsPort,
    url: parseUrl(
      rawEmbeddings.url ?? `http://127.0.0.1:${embeddingsPort}`,
      "localModels.embeddings.url"
    )
  };
  const rawDownload = localModels.download ?? {};
  const download = {
    connections: parseBoundedPositiveInt(
      rawDownload.connections ?? readDefaults().download.connections,
      "localModels.download.connections",
      1,
      MAX_DOWNLOAD_CONNECTIONS
    ),
    hfEndpoint: parseHfEndpoint(
      rawDownload.hfEndpoint ?? readDefaults().download.hfEndpoint,
      "localModels.download.hfEndpoint"
    )
  };
  const localModelsMode = parseLocalLlmMode(
    localModels.mode ?? readDefaults().mode,
    "localModels.mode"
  );
  const localModelsUrl = parseUrl(
    localModels.url ?? readDefaults().url,
    "localModels.url"
  );
  return {
    raw: localModels,
    inputVersion,
    customModels,
    managed,
    embeddings: embeddingsDaemon,
    download,
    mode: localModelsMode,
    url: localModelsUrl
  };
}
function parseUserLocalModelsConfig(prepared, readDefaults) {
  const {
    raw: localModels,
    inputVersion,
    customModels,
    managed,
    embeddings: embeddingsDaemon,
    download,
    mode: localModelsMode,
    url: localModelsUrl
  } = prepared;
  return {
    url: localModelsUrl,
    mode: localModelsMode,
    completionMaxTokens: parseLocalCompletionCap(
      localModels.completionMaxTokens ?? readDefaults().completionMaxTokens,
      "localModels.completionMaxTokens"
    ),
    useServerTemplate: parseLocalTemplateSetting(
      localModels.useServerTemplate ?? readDefaults().useServerTemplate,
      "localModels.useServerTemplate"
    ),
    thinking: parseLocalTemplateSetting(
      localModels.thinking ?? readDefaults().thinking,
      "localModels.thinking"
    ),
    reasoningBudgetTokens: resolveReasoningBudgetTokens(
      inputVersion,
      localModels.reasoningBudgetTokens,
      readDefaults
    ),
    drySampler: parseBool(
      localModels.drySampler ?? readDefaults().drySampler,
      "localModels.drySampler"
    ),
    managed,
    embeddings: embeddingsDaemon,
    download,
    customModels
  };
}
export {
  parseBackendVariant,
  parseCoreBackendVariant,
  parseLocalCompletionCap,
  parseLocalLlmMode,
  parseLocalTemplateSetting,
  parseReasoningBudgetTokens,
  parseSwaFullPreference,
  parseTensorSplit,
  parseUserLocalModelsConfig,
  prepareLocalModelsInputs
};
