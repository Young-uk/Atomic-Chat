import { parseCompactionConfig } from "./compaction-config.mjs";
import { ConfigValidationError } from "../config-validation-error.mjs";
import {
  coerceIntLike,
  parseBool,
  parsePositiveInt,
  parseBoundedPositiveInt,
  parseNonNegativeInt,
  parseHalfOpenUnitInterval
} from "../config-primitives.mjs";
import { parseProviderWait, parseAgentTask } from "../agent-execution-config.mjs";
const READ_SCOPES = [
  "working-dir",
  "unrestricted"
];
function parseReadScope(raw, field) {
  if (typeof raw === "string" && READ_SCOPES.includes(raw)) {
    return raw;
  }
  throw new ConfigValidationError(
    field,
    `expected ${READ_SCOPES.join("|")}, got ${JSON.stringify(raw)}`
  );
}
function parseApprovalLevel(raw, field) {
  const value = coerceIntLike(raw);
  if (Number.isInteger(value) && value >= 1 && value <= 5) {
    return value;
  }
  throw new ConfigValidationError(
    field,
    `expected an integer between 1 and 5, got ${JSON.stringify(raw)}`
  );
}
const CONVERSATION_MAX_PAIRS_MIN = 1;
const CONVERSATION_MAX_PAIRS_MAX = 1e3;
function resolveApprovalLevel(rawLevel, rawLegacyRequired, readDefaults) {
  if (rawLevel !== void 0 && rawLevel !== null) {
    return parseApprovalLevel(rawLevel, "agent.approvalLevel");
  }
  if (rawLegacyRequired !== void 0 && rawLegacyRequired !== null) {
    return parseBool(rawLegacyRequired, "agent.approvalRequired") ? 1 : 5;
  }
  return readDefaults().approvalLevel;
}
function parseAgentConfig(agent, readDefaults) {
  return {
    tokenBudget: parsePositiveInt(
      agent.tokenBudget ?? readDefaults().tokenBudget,
      "agent.tokenBudget"
    ),
    maxSteps: parsePositiveInt(
      agent.maxSteps ?? readDefaults().maxSteps,
      "agent.maxSteps"
    ),
    providerWait: parseProviderWait(
      agent.providerWait,
      readDefaults().providerWait
    ),
    nameSessions: parseBool(
      agent.nameSessions ?? readDefaults().nameSessions,
      "agent.nameSessions"
    ),
    task: parseAgentTask(
      agent.task,
      readDefaults().task
    ),
    toolTimeoutMs: parsePositiveInt(
      agent.toolTimeoutMs ?? readDefaults().toolTimeoutMs,
      "agent.toolTimeoutMs"
    ),
    // The upgrade step for a pre-v67 file: no field, the default.
    readScope: parseReadScope(
      agent.readScope ?? readDefaults().readScope,
      "agent.readScope"
    ),
    approvalLevel: resolveApprovalLevel(
      agent.approvalLevel,
      agent.approvalRequired,
      readDefaults
    ),
    // Non-negative rather than positive: `0` is the "auto" sentinel
    // (`CONVERSATION_CAP_AUTO`), not a request for a zero-token
    // transcript.
    compaction: parseCompactionConfig(agent.compaction, readDefaults().compaction),
    conversationMaxTokens: parseNonNegativeInt(
      agent.conversationMaxTokens ?? readDefaults().conversationMaxTokens,
      "agent.conversationMaxTokens"
    ),
    // Bounded, unlike the token cap: there is no "auto" here. `1`
    // means the agent sees only the task in front of it; the upper
    // bound keeps a fat-fingered `1000` from turning into a prompt
    // nobody meant to pay for.
    conversationMaxPairs: parseBoundedPositiveInt(
      agent.conversationMaxPairs ?? readDefaults().conversationMaxPairs,
      "agent.conversationMaxPairs",
      CONVERSATION_MAX_PAIRS_MIN,
      CONVERSATION_MAX_PAIRS_MAX
    ),
    // `(0, 1]`: `1` is a real setting (cut just enough, every step),
    // `0` would drop the whole transcript at the first overflow.
    conversationLowWater: parseHalfOpenUnitInterval(
      agent.conversationLowWater ?? readDefaults().conversationLowWater,
      "agent.conversationLowWater"
    ),
    // Non-negative like `conversationMaxTokens`, and for the same
    // reason: `0` is the "derive it from the share" sentinel
    // (`SESSION_SECTIONS_CAP_AUTO`), not a request for no session
    // sections at all.
    sessionSectionsMaxTokens: parseNonNegativeInt(
      agent.sessionSectionsMaxTokens ?? readDefaults().sessionSectionsMaxTokens,
      "agent.sessionSectionsMaxTokens"
    ),
    worldSnapshotMaxTokens: parsePositiveInt(
      agent.worldSnapshotMaxTokens ?? readDefaults().worldSnapshotMaxTokens,
      "agent.worldSnapshotMaxTokens"
    )
  };
}
export {
  CONVERSATION_MAX_PAIRS_MAX,
  CONVERSATION_MAX_PAIRS_MIN,
  READ_SCOPES,
  parseAgentConfig,
  parseApprovalLevel,
  parseReadScope
};
