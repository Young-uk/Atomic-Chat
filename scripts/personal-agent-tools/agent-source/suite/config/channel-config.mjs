import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parseNonEmptyString } from "./config-primitives.mjs";
import { parseNullableString } from "./config-values.mjs";
const SWARM_UNIT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SWARM_TOKEN_ENV = /^[A-Z_][A-Z0-9_]*$/;
const SWARM_LABEL_MAX = 40;
const SWARM_ROLE_MAX = 120;
const DISCORD_SNOWFLAKE_RE = /^\d{15,25}$/;
function parseSwarmUnits(value, field) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ConfigValidationError(field, "must be an array");
  }
  const ids = /* @__PURE__ */ new Set();
  const envs = /* @__PURE__ */ new Set();
  return value.map((raw, i) => {
    const at = `${field}[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ConfigValidationError(at, "must be an object");
    }
    const u = raw;
    const id = parseNonEmptyString(u.id, `${at}.id`);
    if (!SWARM_UNIT_ID.test(id)) {
      throw new ConfigValidationError(
        `${at}.id`,
        "must match [a-z0-9][a-z0-9-]{0,31}"
      );
    }
    if (ids.has(id))
      throw new ConfigValidationError(`${at}.id`, `duplicate id '${id}'`);
    ids.add(id);
    if (u.kind !== "telegram" && u.kind !== "discord") {
      throw new ConfigValidationError(
        `${at}.kind`,
        'must be "telegram" or "discord"'
      );
    }
    const label = parseNonEmptyString(u.label, `${at}.label`);
    if (label.length > SWARM_LABEL_MAX) {
      throw new ConfigValidationError(
        `${at}.label`,
        `must be at most ${SWARM_LABEL_MAX} characters`
      );
    }
    const role = u.role === void 0 || u.role === null ? "" : u.role;
    if (typeof role !== "string" || role.length > SWARM_ROLE_MAX) {
      throw new ConfigValidationError(
        `${at}.role`,
        `must be a string of at most ${SWARM_ROLE_MAX} characters`
      );
    }
    const tokenEnv = parseNonEmptyString(u.tokenEnv, `${at}.tokenEnv`);
    if (!SWARM_TOKEN_ENV.test(tokenEnv)) {
      throw new ConfigValidationError(
        `${at}.tokenEnv`,
        "must be an env var name ([A-Z_][A-Z0-9_]*)"
      );
    }
    if (envs.has(tokenEnv)) {
      throw new ConfigValidationError(
        `${at}.tokenEnv`,
        `duplicate token env '${tokenEnv}'`
      );
    }
    envs.add(tokenEnv);
    const ownerUserId = parseNullableString(u.ownerUserId, `${at}.ownerUserId`);
    if (ownerUserId !== null && !/^\d{1,25}$/.test(ownerUserId)) {
      throw new ConfigValidationError(
        `${at}.ownerUserId`,
        "must be a numeric user id"
      );
    }
    return {
      id,
      kind: u.kind,
      label,
      role,
      enabled: parseBool(u.enabled ?? false, `${at}.enabled`),
      tokenEnv,
      ownerUserId
    };
  });
}
function parseDiscordOwnerUserIds(discord) {
  const field = "discord.ownerUserIds";
  const raw = discord.ownerUserIds;
  if (raw === void 0 || raw === null) {
    const legacy = parseNullableString(
      discord.ownerUserId,
      "discord.ownerUserId"
    );
    if (legacy === null) return [];
    if (!DISCORD_SNOWFLAKE_RE.test(legacy)) {
      throw new ConfigValidationError(
        "discord.ownerUserId",
        `expected a 15-25 digit Discord user id, got ${JSON.stringify(legacy)}`
      );
    }
    return [legacy];
  }
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected string[], got ${JSON.stringify(raw)}`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "string" || !DISCORD_SNOWFLAKE_RE.test(entry)) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected a 15-25 digit Discord user id, got ${JSON.stringify(entry)}`
      );
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
function parseTelegramParseMode(raw, field) {
  if (raw === "plain" || raw === "html") return raw;
  throw new ConfigValidationError(
    field,
    `expected one of plain|html, got ${JSON.stringify(raw)}`
  );
}
function parseTelegramOwnerId(raw, field) {
  if (raw === null || raw === void 0) return null;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new ConfigValidationError(
      field,
      `expected positive integer or null, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function createTelegramDefaults() {
  return {
    enabled: false,
    ownerUserId: null,
    parseMode: "html",
    progressIndicator: true
  };
}
function parseTelegramConfig(raw, readDefaults) {
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "telegram.enabled"
    ),
    ownerUserId: parseTelegramOwnerId(
      raw.ownerUserId ?? readDefaults().ownerUserId,
      "telegram.ownerUserId"
    ),
    parseMode: parseTelegramParseMode(
      raw.parseMode ?? readDefaults().parseMode,
      "telegram.parseMode"
    ),
    progressIndicator: parseBool(
      raw.progressIndicator ?? readDefaults().progressIndicator,
      "telegram.progressIndicator"
    )
  };
}
function createDiscordDefaults() {
  return {
    // Added in v51. Off by default: an unpaired channel with a token
    // would connect and then refuse every message, which looks broken.
    enabled: false,
    // v52: a list. Empty is the unpaired state the switch above assumes.
    ownerUserIds: []
  };
}
function parseDiscordConfig(raw, readDefaults) {
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "discord.enabled"
    ),
    ownerUserIds: parseDiscordOwnerUserIds(raw)
  };
}
function createSwarmDefaults() {
  return {
    // Added in v52. No extra bots until the operator adds one.
    units: []
  };
}
function parseSwarmConfig(raw) {
  return {
    units: parseSwarmUnits(raw.units, "swarm.units")
  };
}
export {
  SWARM_UNIT_ID,
  createDiscordDefaults,
  createSwarmDefaults,
  createTelegramDefaults,
  parseDiscordConfig,
  parseDiscordOwnerUserIds,
  parseSwarmConfig,
  parseTelegramConfig,
  parseTelegramOwnerId
};
