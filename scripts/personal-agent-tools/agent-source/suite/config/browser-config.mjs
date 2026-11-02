import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseNullableString, parseStringArrayOrNull } from "./config-values.mjs";
const BROWSER_CONNECT_MODES = [
  "agent",
  "user-chrome"
];
function createBrowserDefaults() {
  return {
    blockedDomains: [],
    allowedDomains: [],
    connect: "agent",
    cdpUrl: null,
    userDataDir: null
  };
}
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
const CDP_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:", "ws:", "wss:"]);
function cdpUrlProblem(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (!CDP_PROTOCOLS.has(url.protocol)) {
    return `scheme ${url.protocol} is not http, https, ws or wss`;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return `host ${url.hostname} is not this machine (only 127.0.0.1, localhost or [::1]); a DevTools endpoint gives full control of the browser`;
  }
  return null;
}
function parseCdpUrl(raw, field) {
  const value = parseNullableString(raw, field);
  if (value === null) return null;
  const problem = cdpUrlProblem(value);
  if (problem) throw new ConfigValidationError(field, problem);
  return value;
}
function parseConnectMode(raw, field) {
  if (raw === "agent" || raw === "user-chrome") return raw;
  throw new ConfigValidationError(
    field,
    `expected one of ${BROWSER_CONNECT_MODES.join(" | ")}, got ${JSON.stringify(raw)}`
  );
}
function parseBrowserConfig(raw, readDefaults) {
  const defaults = readDefaults();
  return {
    blockedDomains: parseStringArrayOrNull(
      raw.blockedDomains ?? defaults.blockedDomains,
      "browser.blockedDomains"
    ) ?? [],
    allowedDomains: parseStringArrayOrNull(
      raw.allowedDomains ?? defaults.allowedDomains,
      "browser.allowedDomains"
    ) ?? [],
    connect: parseConnectMode(raw.connect ?? defaults.connect, "browser.connect"),
    cdpUrl: parseCdpUrl(
      raw.cdpUrl === void 0 ? defaults.cdpUrl : raw.cdpUrl,
      "browser.cdpUrl"
    ),
    userDataDir: parseNullableString(
      raw.userDataDir === void 0 ? defaults.userDataDir : raw.userDataDir,
      "browser.userDataDir"
    )
  };
}
export {
  BROWSER_CONNECT_MODES,
  cdpUrlProblem,
  createBrowserDefaults,
  parseBrowserConfig
};
