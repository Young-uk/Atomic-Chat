import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseNonEmptyString } from "./config-primitives.mjs";
function parseWebhookMap(raw, field) {
  if (raw === null || raw === void 0) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const out = {};
  for (const [name, rawCfg] of Object.entries(raw)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new ConfigValidationError(
        `${field}.${name}`,
        "webhook name must match [a-zA-Z0-9_-]+"
      );
    }
    if (rawCfg === null || typeof rawCfg !== "object" || Array.isArray(rawCfg)) {
      throw new ConfigValidationError(
        `${field}.${name}`,
        `expected object, got ${JSON.stringify(rawCfg)}`
      );
    }
    const cfg = rawCfg;
    const userMessageTemplate = parseNonEmptyString(
      cfg.userMessageTemplate,
      `${field}.${name}.userMessageTemplate`
    );
    const sessionMode = cfg.sessionMode ?? "ephemeral";
    if (sessionMode !== "ephemeral" && sessionMode !== "persistent" && sessionMode !== "named") {
      throw new ConfigValidationError(
        `${field}.${name}.sessionMode`,
        `expected ephemeral|persistent|named, got ${JSON.stringify(sessionMode)}`
      );
    }
    let sessionId;
    if (cfg.sessionId !== void 0 && cfg.sessionId !== null) {
      sessionId = parseNonEmptyString(
        cfg.sessionId,
        `${field}.${name}.sessionId`
      );
    }
    if (sessionMode === "named" && !sessionId) {
      throw new ConfigValidationError(
        `${field}.${name}.sessionId`,
        "sessionMode=named requires a non-empty sessionId"
      );
    }
    let secret;
    if (cfg.secret !== void 0 && cfg.secret !== null) {
      secret = parseNonEmptyString(cfg.secret, `${field}.${name}.secret`);
    }
    let schedule;
    if (cfg.schedule !== void 0 && cfg.schedule !== null) {
      schedule = parseWebhookSchedule(
        cfg.schedule,
        `${field}.${name}.schedule`
      );
    }
    out[name] = {
      userMessageTemplate,
      sessionMode,
      ...sessionId ? { sessionId } : {},
      ...secret ? { secret } : {},
      ...schedule ? { schedule } : {}
    };
  }
  return out;
}
function parseWebhookSchedule(raw, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected schedule object");
  }
  const obj = raw;
  if (obj.kind === "at") {
    const at = obj.at;
    if (typeof at !== "number" || !Number.isFinite(at)) {
      throw new ConfigValidationError(
        `${field}.at`,
        "expected finite number (Unix ms)"
      );
    }
    return { kind: "at", at };
  }
  if (obj.kind === "interval") {
    const everyMs = obj.everyMs;
    if (typeof everyMs !== "number" || !Number.isInteger(everyMs) || everyMs <= 0) {
      throw new ConfigValidationError(
        `${field}.everyMs`,
        "expected positive integer"
      );
    }
    return { kind: "interval", everyMs };
  }
  if (obj.kind === "cron") {
    const expression = parseNonEmptyString(
      obj.expression,
      `${field}.expression`
    );
    const tz = typeof obj.tz === "string" ? obj.tz : void 0;
    return { kind: "cron", expression, ...tz ? { tz } : {} };
  }
  throw new ConfigValidationError(
    `${field}.kind`,
    `expected at|cron|interval, got ${JSON.stringify(obj.kind)}`
  );
}
export {
  parseWebhookMap
};
