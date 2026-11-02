import { parseBoolOrNull, parsePositiveInt } from "./config-primitives.mjs";
function createTracingDefaults() {
  return {
    trace: {
      enabled: null,
      maxBytesPerSession: 10 * 1024 * 1024
    }
  };
}
function parseTracingConfig(mergedTrace, readDefaults) {
  return {
    trace: {
      enabled: parseBoolOrNull(
        mergedTrace.enabled ?? readDefaults().trace.enabled,
        "tracing.trace.enabled"
      ),
      maxBytesPerSession: parsePositiveInt(
        mergedTrace.maxBytesPerSession ?? readDefaults().trace.maxBytesPerSession,
        "tracing.trace.maxBytesPerSession"
      )
    }
  };
}
export {
  createTracingDefaults,
  parseTracingConfig
};
