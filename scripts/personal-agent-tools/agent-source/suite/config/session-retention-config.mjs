import { parsePositiveInt, parseBool } from "./config-primitives.mjs";
function parseCapOrNull(raw, field, fallback) {
  if (raw === void 0) return fallback;
  if (raw === null) return null;
  return parsePositiveInt(raw, field);
}
function createSessionDefaults() {
  return {
    retention: {
      // Off. Deleting an operator's transcripts is not a default.
      enabled: false,
      // A quarter: long enough that "what did I do on that project?"
      // still has an answer, short enough that an install left running
      // for a year is not carrying every session it ever had.
      maxAgeDays: 90,
      // No cap. Age is a statement about what is still interesting; a
      // row count is a statement about disk, and only the operator
      // knows whether theirs is the problem.
      maxRows: null
    }
  };
}
function parseSessionConfig(sessionsRetention, readDefaults) {
  return {
    retention: {
      enabled: parseBool(
        sessionsRetention.enabled ?? readDefaults().retention.enabled,
        "sessions.retention.enabled"
      ),
      maxAgeDays: parseCapOrNull(
        sessionsRetention.maxAgeDays,
        "sessions.retention.maxAgeDays",
        readDefaults().retention.maxAgeDays
      ),
      maxRows: parseCapOrNull(
        sessionsRetention.maxRows,
        "sessions.retention.maxRows",
        readDefaults().retention.maxRows
      )
    }
  };
}
export {
  createSessionDefaults,
  parseSessionConfig
};
