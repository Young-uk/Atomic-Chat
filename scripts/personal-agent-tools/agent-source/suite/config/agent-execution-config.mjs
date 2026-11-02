import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parsePositiveInt } from "./config-primitives.mjs";
function createProviderWaitDefaults() {
  return {
    enabled: true,
    // Five minutes covers the outages people actually hit — a laptop
    // waking, a VPN reconnecting, a provider's gateway restarting —
    // without leaving a turn parked all afternoon. The task's own
    // wall-clock ceiling still applies on top.
    maxWaitMs: 3e5
  };
}
function createAgentTaskDefaults() {
  return {
    // ~40 legs of 25. Large enough for the multi-hour browser jobs
    // people actually ask for, small enough that a runaway is bounded
    // and visible: every leg boundary reports steps, elapsed time and
    // the ceiling it is counting towards.
    maxSteps: 1e3,
    maxDurationMs: 72e5,
    autoContinue: true
  };
}
function parseProviderWait(raw, defaults) {
  if (raw === void 0 || raw === null) return defaults;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "agent.providerWait",
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const wait = raw;
  return {
    enabled: parseBool(
      wait.enabled ?? defaults.enabled,
      "agent.providerWait.enabled"
    ),
    maxWaitMs: parsePositiveInt(
      wait.maxWaitMs ?? defaults.maxWaitMs,
      "agent.providerWait.maxWaitMs"
    )
  };
}
function parseAgentTask(raw, defaults) {
  if (raw === void 0 || raw === null) return defaults;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "agent.task",
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const task = raw;
  return {
    maxSteps: parsePositiveInt(
      task.maxSteps ?? defaults.maxSteps,
      "agent.task.maxSteps"
    ),
    maxDurationMs: parsePositiveInt(
      task.maxDurationMs ?? defaults.maxDurationMs,
      "agent.task.maxDurationMs"
    ),
    autoContinue: parseBool(
      task.autoContinue ?? defaults.autoContinue,
      "agent.task.autoContinue"
    )
  };
}
export {
  createAgentTaskDefaults,
  createProviderWaitDefaults,
  parseAgentTask,
  parseProviderWait
};
