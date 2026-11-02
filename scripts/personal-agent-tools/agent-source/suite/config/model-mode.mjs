import { ConfigValidationError } from "./config-validation-error.mjs";
import { usesExternalCliAuth } from "./provider-auth-mode.mjs";
import { PROVIDER_PRESETS } from "../llm/provider/presets/provider-presets.mjs";
function defaultProviderModelMode(entry) {
  if (entry.kind === "openrouter" || entry.kind === "aimlapi" || entry.kind === "gemini" || usesExternalCliAuth(entry)) return "cloud";
  if (entry.kind !== "openai-compatible" || !entry.baseUrl) return "local";
  try {
    const origin = new URL(entry.baseUrl).origin;
    if (origin === "https://api.openai.com" || PROVIDER_PRESETS.some((preset) => !preset.local && new URL(preset.baseUrl).origin === origin)) return "cloud";
  } catch {
  }
  return "local";
}
function parseModelMode(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (raw === "local" || raw === "cloud") return raw;
  throw new ConfigValidationError(field, "expected local|cloud");
}
function parseModelModes(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected object mapping model ids to local|cloud");
  }
  return Object.fromEntries(Object.entries(raw).map(([id, value]) => {
    if (!id.trim()) throw new ConfigValidationError(field, "model id must not be empty");
    const mode = parseModelMode(value, `${field}.${id}`);
    if (mode === void 0) throw new ConfigValidationError(`${field}.${id}`, "expected local|cloud");
    return [id, mode];
  }));
}
export {
  defaultProviderModelMode,
  parseModelMode,
  parseModelModes
};
