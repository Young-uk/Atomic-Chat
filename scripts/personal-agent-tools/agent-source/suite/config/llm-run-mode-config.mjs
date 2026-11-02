import { ConfigValidationError } from "./config-validation-error.mjs";
const FUSION_WORKER_REASONING_LEVELS = [
  "low",
  "medium",
  "high"
];
const FUSION_WORKER_MAX_OUTPUT_TOKENS_MAX = 1e6;
const RUN_MODE_NAMES = [
  "local",
  "cloud",
  "fusion"
];
const LOCAL_PROVIDER_KIND = "llama-server";
const FUSION_WORKERS_MIN = 1;
const FUSION_WORKERS_MAX = 8;
const DEFAULT_FUSION_WORKERS = 2;
const FUSION_CLOUD_WORKERS_MAX = 32;
const DEFAULT_FUSION_CLOUD_WORKERS = 4;
const DEFAULT_FUSION_WORKER_MAX_STEPS = 60;
const DEFAULT_FUSION_WORKER_TIMEOUT_MS = 27e5;
const DEFAULT_FUSION_REVIEW_STALL_STEPS = 6;
const FUSION_REVIEW_STALL_STEPS_MAX = 1e3;
function parseLegProviderId(raw, providers, field) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigValidationError(field, "expected non-empty string");
  }
  const entry = providers.find((p) => p.id === raw);
  if (!entry) {
    throw new ConfigValidationError(
      field,
      `unknown provider id ${JSON.stringify(raw)}`
    );
  }
  return raw;
}
function parseBoundedInt(raw, field, min, max) {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ConfigValidationError(
      field,
      `expected an integer ${min}-${max}, got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}
function parseOptionalLabel(raw, field) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigValidationError(field, "expected non-empty string");
  }
  return raw;
}
function parseFusion(raw, providers, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const out = {};
  if (obj.orchestratorProvider !== void 0) {
    out.orchestratorProvider = parseLegProviderId(
      obj.orchestratorProvider,
      providers,
      `${field}.orchestratorProvider`
    );
  }
  if (obj.orchestratorModel !== void 0) {
    out.orchestratorModel = parseOptionalLabel(
      obj.orchestratorModel,
      `${field}.orchestratorModel`
    );
  }
  if (obj.workerProvider !== void 0) {
    out.workerProvider = parseLegProviderId(
      obj.workerProvider,
      providers,
      `${field}.workerProvider`
    );
  }
  if (obj.workerModel !== void 0) {
    out.workerModel = parseOptionalLabel(
      obj.workerModel,
      `${field}.workerModel`
    );
  }
  if (obj.workers !== void 0) {
    out.workers = parseBoundedInt(
      obj.workers,
      `${field}.workers`,
      FUSION_WORKERS_MIN,
      FUSION_WORKERS_MAX
    );
  }
  if (obj.cloudWorkers !== void 0) {
    out.cloudWorkers = parseBoundedInt(
      obj.cloudWorkers,
      `${field}.cloudWorkers`,
      FUSION_WORKERS_MIN,
      FUSION_CLOUD_WORKERS_MAX
    );
  }
  if (obj.workerReasoning !== void 0) {
    const level = obj.workerReasoning;
    if (typeof level !== "string" || !FUSION_WORKER_REASONING_LEVELS.includes(level)) {
      throw new ConfigValidationError(
        `${field}.workerReasoning`,
        `expected ${FUSION_WORKER_REASONING_LEVELS.join("|")}`
      );
    }
    out.workerReasoning = level;
  }
  if (obj.workerMaxOutputTokens !== void 0) {
    out.workerMaxOutputTokens = parseBoundedInt(
      obj.workerMaxOutputTokens,
      `${field}.workerMaxOutputTokens`,
      1,
      FUSION_WORKER_MAX_OUTPUT_TOKENS_MAX
    );
  }
  if (obj.workerMaxSteps !== void 0) {
    out.workerMaxSteps = parseBoundedInt(
      obj.workerMaxSteps,
      `${field}.workerMaxSteps`,
      1,
      1e3
    );
  }
  if (obj.workerTimeoutMs !== void 0) {
    out.workerTimeoutMs = parseBoundedInt(
      obj.workerTimeoutMs,
      `${field}.workerTimeoutMs`,
      1e3,
      864e5
    );
  }
  if (obj.reviewStallSteps !== void 0) {
    out.reviewStallSteps = parseBoundedInt(
      obj.reviewStallSteps,
      `${field}.reviewStallSteps`,
      0,
      FUSION_REVIEW_STALL_STEPS_MAX
    );
  }
  return out;
}
function parseLlmRunModeConfig(raw, providers, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object");
  }
  const obj = raw;
  const out = {};
  if (obj.mode !== void 0) {
    const mode = obj.mode;
    if (typeof mode !== "string" || !RUN_MODE_NAMES.includes(mode)) {
      throw new ConfigValidationError(
        `${field}.mode`,
        `expected ${RUN_MODE_NAMES.join("|")}`
      );
    }
    out.mode = mode;
  }
  if (obj.fusion !== void 0) {
    out.fusion = parseFusion(obj.fusion, providers, `${field}.fusion`);
  }
  return out;
}
function scrubRunModeProviderPins(runMode, removedId) {
  if (!runMode?.fusion) return runMode;
  const {
    orchestratorProvider,
    orchestratorModel,
    workerProvider,
    workerModel,
    ...rest
  } = runMode.fusion;
  const keepOrchestrator = orchestratorProvider !== removedId;
  const keepWorker = workerProvider !== removedId;
  if (keepOrchestrator && keepWorker) return runMode;
  return {
    ...runMode,
    fusion: {
      ...rest,
      ...orchestratorProvider && keepOrchestrator ? { orchestratorProvider } : {},
      ...orchestratorModel !== void 0 && keepOrchestrator ? { orchestratorModel } : {},
      ...workerProvider && keepWorker ? { workerProvider } : {},
      ...workerModel !== void 0 && keepWorker ? { workerModel } : {}
    }
  };
}
export {
  DEFAULT_FUSION_CLOUD_WORKERS,
  DEFAULT_FUSION_REVIEW_STALL_STEPS,
  DEFAULT_FUSION_WORKERS,
  DEFAULT_FUSION_WORKER_MAX_STEPS,
  DEFAULT_FUSION_WORKER_TIMEOUT_MS,
  FUSION_CLOUD_WORKERS_MAX,
  FUSION_REVIEW_STALL_STEPS_MAX,
  FUSION_WORKERS_MAX,
  FUSION_WORKERS_MIN,
  FUSION_WORKER_MAX_OUTPUT_TOKENS_MAX,
  FUSION_WORKER_REASONING_LEVELS,
  LOCAL_PROVIDER_KIND,
  RUN_MODE_NAMES,
  parseLlmRunModeConfig,
  scrubRunModeProviderPins
};
