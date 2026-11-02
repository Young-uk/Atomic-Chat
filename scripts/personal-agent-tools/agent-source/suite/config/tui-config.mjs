import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parseNonNegativeInt, parseNonEmptyString } from "./config-primitives.mjs";
import { parseSessionRailConfig } from "./session-rail-config.mjs";
function createTuiDefaults() {
  return {
    theme: "auto",
    whileBusySubmit: "steer",
    mouse: true,
    notify: { enabled: true, minDurationMs: 3e4 },
    sessionRail: { order: [], pinned: [] },
    onboarding: {
      completedAt: null,
      importOfferedAt: null,
      introSeenAt: null,
      localSetupSeenAt: null,
      proposedSecondBackendAt: null,
      skippedAt: null
    }
  };
}
function parseWhileBusySubmit(raw, field) {
  if (raw === "steer" || raw === "queue") return raw;
  throw new ConfigValidationError(
    field,
    `expected "steer" or "queue", got ${JSON.stringify(raw)}`
  );
}
function parseTimestampOrNull(raw, field) {
  if (raw === void 0 || raw === null) return null;
  const s = parseNonEmptyString(raw, field);
  if (Number.isNaN(Date.parse(s))) {
    throw new ConfigValidationError(
      field,
      `expected an ISO-8601 timestamp, got ${JSON.stringify(s)}`
    );
  }
  return s;
}
function parseThemeName(raw, field) {
  if (typeof raw !== "string") {
    throw new ConfigValidationError(
      field,
      `expected a string, got ${JSON.stringify(raw)}`
    );
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? "auto" : trimmed;
}
function parseOnboardingStateWithDefaults(raw, readDefaults) {
  const defaults = readDefaults();
  if (raw === void 0 || raw === null) return { ...defaults };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "tui.onboarding",
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const obj = raw;
  return {
    completedAt: parseTimestampOrNull(
      obj.completedAt,
      "tui.onboarding.completedAt"
    ),
    introSeenAt: parseTimestampOrNull(
      obj.introSeenAt,
      "tui.onboarding.introSeenAt"
    ),
    skippedAt: parseTimestampOrNull(obj.skippedAt, "tui.onboarding.skippedAt"),
    proposedSecondBackendAt: parseTimestampOrNull(
      obj.proposedSecondBackendAt,
      "tui.onboarding.proposedSecondBackendAt"
    ),
    localSetupSeenAt: parseTimestampOrNull(
      obj.localSetupSeenAt,
      "tui.onboarding.localSetupSeenAt"
    ),
    importOfferedAt: parseTimestampOrNull(
      obj.importOfferedAt,
      "tui.onboarding.importOfferedAt"
    )
  };
}
function parseTuiNotifyWithDefaults(raw, readDefaults) {
  const d = readDefaults();
  if (raw === void 0 || raw === null) return { ...d };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "tui.notify",
      "expected an object with `enabled` and `minDurationMs`"
    );
  }
  const block = raw;
  return {
    enabled: parseBool(block.enabled ?? d.enabled, "tui.notify.enabled"),
    minDurationMs: parseNonNegativeInt(
      block.minDurationMs ?? d.minDurationMs,
      "tui.notify.minDurationMs"
    )
  };
}
function parseTuiConfig(tui, readDefaults) {
  return {
    theme: parseThemeName(
      tui.theme ?? readDefaults().theme,
      "tui.theme"
    ),
    whileBusySubmit: parseWhileBusySubmit(
      tui.whileBusySubmit ?? readDefaults().whileBusySubmit,
      "tui.whileBusySubmit"
    ),
    mouse: parseBool(
      tui.mouse ?? readDefaults().mouse,
      "tui.mouse"
    ),
    onboarding: parseOnboardingStateWithDefaults(
      tui.onboarding,
      () => readDefaults().onboarding
    ),
    sessionRail: parseSessionRailConfig(tui.sessionRail),
    notify: parseTuiNotifyWithDefaults(
      tui.notify,
      () => readDefaults().notify
    )
  };
}
export {
  createTuiDefaults,
  parseOnboardingStateWithDefaults,
  parseThemeName,
  parseTimestampOrNull,
  parseTuiConfig,
  parseTuiNotifyWithDefaults,
  parseWhileBusySubmit
};
