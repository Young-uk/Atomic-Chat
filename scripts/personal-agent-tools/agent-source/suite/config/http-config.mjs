import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parsePositiveInt } from "./config-primitives.mjs";
import { parseStringArrayOrNull } from "./config-values.mjs";
function parseHttpApprovalMode(raw, field) {
  if (raw === "never" || raw === "writes" || raw === "always") return raw;
  throw new ConfigValidationError(
    field,
    `expected one of never|writes|always, got ${JSON.stringify(raw)}`
  );
}
function resolveHttpApprovalMode(inputVersion, raw, field, readDefaults) {
  if (inputVersion < 79 && raw === "never") return "writes";
  return parseHttpApprovalMode(
    raw ?? readDefaults().approvalMode,
    field
  );
}
function createHttpDefaults() {
  return {
    enabled: true,
    approvalMode: "writes",
    hostAllowlist: null,
    maxResponseBytes: 1048576,
    defaultTimeoutMs: 3e4
  };
}
function parseHttpConfig(raw, inputVersion, readDefaults) {
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "http.enabled"
    ),
    approvalMode: resolveHttpApprovalMode(
      inputVersion,
      raw.approvalMode,
      "http.approvalMode",
      readDefaults
    ),
    hostAllowlist: parseStringArrayOrNull(
      raw.hostAllowlist ?? readDefaults().hostAllowlist,
      "http.hostAllowlist"
    ),
    maxResponseBytes: parsePositiveInt(
      raw.maxResponseBytes ?? readDefaults().maxResponseBytes,
      "http.maxResponseBytes"
    ),
    defaultTimeoutMs: parsePositiveInt(
      raw.defaultTimeoutMs ?? readDefaults().defaultTimeoutMs,
      "http.defaultTimeoutMs"
    )
  };
}
export {
  createHttpDefaults,
  parseHttpApprovalMode,
  parseHttpConfig
};
