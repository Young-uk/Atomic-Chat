import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parseNonEmptyString } from "./config-primitives.mjs";
import { parseNullableString } from "./config-values.mjs";
function parseDownloadNotifyChannel(raw, field) {
  if (raw === null || raw === void 0) return null;
  if (raw === "telegram" || raw === "discord" || raw === "email" || raw === "off") {
    return raw;
  }
  throw new ConfigValidationError(
    field,
    `expected "telegram", "discord", "email", "off" or null, got ${JSON.stringify(raw)}`
  );
}
function parsePendingVerification(raw, field) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected an object or null");
  }
  const o = raw;
  const email = parseNullableString(o.email, `${field}.email`);
  const codeHash = parseNullableString(o.codeHash, `${field}.codeHash`);
  const expiresAt = parseNullableString(o.expiresAt, `${field}.expiresAt`);
  if (!email || !codeHash || !expiresAt) {
    throw new ConfigValidationError(
      field,
      "expected email, codeHash and expiresAt"
    );
  }
  const attempts = typeof o.attempts === "number" && o.attempts >= 0 ? Math.floor(o.attempts) : 0;
  return { email, codeHash, expiresAt, attempts };
}
function createNotificationsDefaults() {
  return {
    // Added in v55. `null` = not asked yet; the Models tab asks once.
    downloads: {
      channel: null
    }
  };
}
function createAtomicMailDefaults() {
  return {
    // Added in v56. Nothing until the operator registers an inbox.
    address: null,
    accountId: null,
    ownerEmail: null,
    ownerVerifiedAt: null,
    pendingVerification: null
  };
}
function createGitDefaults() {
  return {
    // Added in v52. Off by default: a repository the agent versions must
    // not reach a remote until the operator deliberately opens the door.
    remoteSync: false
  };
}
function createComposioDefaults() {
  return {
    // Added in v50. `enabled: true` is safe because the key, not this
    // flag, is what actually mounts anything: with no key in the env
    // the runtime opens no connection and registers no tool.
    enabled: true,
    apiKeyEnv: "COMPOSIO_API_KEY",
    userId: null,
    sessionId: null,
    mcpUrl: null
  };
}
function parseNotificationsConfig(rawDownloads, readDefaults) {
  return {
    downloads: {
      channel: parseDownloadNotifyChannel(
        rawDownloads.channel ?? readDefaults().downloads.channel,
        "notifications.downloads.channel"
      )
    }
  };
}
function parseAtomicMailConfig(raw) {
  return {
    address: parseNullableString(raw.address, "atomicMail.address"),
    accountId: parseNullableString(
      raw.accountId,
      "atomicMail.accountId"
    ),
    ownerEmail: parseNullableString(
      raw.ownerEmail,
      "atomicMail.ownerEmail"
    ),
    ownerVerifiedAt: parseNullableString(
      raw.ownerVerifiedAt,
      "atomicMail.ownerVerifiedAt"
    ),
    pendingVerification: parsePendingVerification(
      raw.pendingVerification,
      "atomicMail.pendingVerification"
    )
  };
}
function parseGitConfig(raw, readDefaults) {
  return {
    remoteSync: parseBool(
      raw.remoteSync ?? readDefaults().remoteSync,
      "git.remoteSync"
    )
  };
}
function parseComposioConfig(raw, readDefaults) {
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "composio.enabled"
    ),
    apiKeyEnv: parseNonEmptyString(
      raw.apiKeyEnv ?? readDefaults().apiKeyEnv,
      "composio.apiKeyEnv"
    ),
    userId: parseNullableString(raw.userId, "composio.userId"),
    sessionId: parseNullableString(raw.sessionId, "composio.sessionId"),
    mcpUrl: parseNullableString(raw.mcpUrl, "composio.mcpUrl")
  };
}
export {
  createAtomicMailDefaults,
  createComposioDefaults,
  createGitDefaults,
  createNotificationsDefaults,
  parseAtomicMailConfig,
  parseComposioConfig,
  parseDownloadNotifyChannel,
  parseGitConfig,
  parseNotificationsConfig
};
