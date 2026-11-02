import { ConfigValidationError } from "./config-validation-error.mjs";
import {
  parseBool,
  parsePositiveInt,
  parseBoundedPositiveInt,
  parseNonNegativeBoundedInt,
  parseNonEmptyString
} from "./config-primitives.mjs";
function createWebSearchDefaults() {
  return {
    enabled: true,
    provider: "exa",
    maxResults: 8,
    timeoutMs: 15e3,
    cacheTtlMinutes: 60,
    persistCache: true,
    fallback: ["duckduckgo"],
    searxng: {
      instanceUrl: null
    },
    exa: {
      endpoint: "https://mcp.exa.ai/mcp",
      apiEndpoint: "https://api.exa.ai/search",
      apiKeyEnv: "EXA_API_KEY"
    },
    brave: {
      apiKeyEnv: "BRAVE_SEARCH_API_KEY"
    }
  };
}
function createWebFetchDefaults() {
  return {
    timeoutMs: 3e4,
    connectTimeoutMs: 1e4,
    maxRetries: 2,
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 5e3
  };
}
function parseWebSearchProviderName(raw, field) {
  if (raw === "duckduckgo" || raw === "searxng" || raw === "exa" || raw === "brave") {
    return raw;
  }
  throw new ConfigValidationError(
    field,
    `expected one of duckduckgo|searxng|exa|brave, got ${JSON.stringify(raw)}`
  );
}
function parseWebSearchFallback(raw, primary, field) {
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected an array of provider names, got ${JSON.stringify(raw)}`
    );
  }
  const seen = /* @__PURE__ */ new Set([primary]);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const name = parseWebSearchProviderName(raw[i], `${field}[${i}]`);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
function prepareWebSearchInputs(raw, readDefaults) {
  const provider = parseWebSearchProviderName(
    raw.provider ?? readDefaults().provider,
    "web.search.provider"
  );
  const searxng = raw.searxng ?? {};
  const exa = raw.exa ?? {};
  const brave = raw.brave ?? {};
  return { raw, provider, searxng, exa, brave };
}
function parseWebSearchConfig(prepared, readDefaults) {
  const { raw, provider, searxng, exa, brave } = prepared;
  return {
    enabled: parseBool(
      raw.enabled ?? readDefaults().enabled,
      "web.search.enabled"
    ),
    provider,
    maxResults: parseBoundedPositiveInt(
      raw.maxResults ?? readDefaults().maxResults,
      "web.search.maxResults",
      1,
      20
    ),
    timeoutMs: parsePositiveInt(
      raw.timeoutMs ?? readDefaults().timeoutMs,
      "web.search.timeoutMs"
    ),
    cacheTtlMinutes: parseNonNegativeBoundedInt(
      raw.cacheTtlMinutes ?? readDefaults().cacheTtlMinutes,
      "web.search.cacheTtlMinutes",
      0,
      1440
    ),
    persistCache: parseBool(
      raw.persistCache ?? readDefaults().persistCache,
      "web.search.persistCache"
    ),
    fallback: parseWebSearchFallback(
      raw.fallback ?? readDefaults().fallback,
      provider,
      "web.search.fallback"
    ),
    searxng: {
      instanceUrl: searxng.instanceUrl === null || searxng.instanceUrl === void 0 ? null : parseNonEmptyString(
        searxng.instanceUrl,
        "web.search.searxng.instanceUrl"
      )
    },
    exa: {
      endpoint: parseNonEmptyString(
        exa.endpoint ?? readDefaults().exa.endpoint,
        "web.search.exa.endpoint"
      ),
      apiEndpoint: parseNonEmptyString(
        exa.apiEndpoint ?? readDefaults().exa.apiEndpoint,
        "web.search.exa.apiEndpoint"
      ),
      apiKeyEnv: parseNonEmptyString(
        exa.apiKeyEnv ?? readDefaults().exa.apiKeyEnv,
        "web.search.exa.apiKeyEnv"
      )
    },
    brave: {
      apiKeyEnv: parseNonEmptyString(
        brave.apiKeyEnv ?? readDefaults().brave.apiKeyEnv,
        "web.search.brave.apiKeyEnv"
      )
    }
  };
}
function parseWebFetchConfig(raw, readDefaults) {
  return {
    timeoutMs: parsePositiveInt(
      raw.timeoutMs ?? readDefaults().timeoutMs,
      "web.fetch.timeoutMs"
    ),
    connectTimeoutMs: parsePositiveInt(
      raw.connectTimeoutMs ?? readDefaults().connectTimeoutMs,
      "web.fetch.connectTimeoutMs"
    ),
    maxRetries: parseNonNegativeBoundedInt(
      raw.maxRetries ?? readDefaults().maxRetries,
      "web.fetch.maxRetries",
      0,
      5
    ),
    retryBaseDelayMs: parsePositiveInt(
      raw.retryBaseDelayMs ?? readDefaults().retryBaseDelayMs,
      "web.fetch.retryBaseDelayMs"
    ),
    retryMaxDelayMs: parsePositiveInt(
      raw.retryMaxDelayMs ?? readDefaults().retryMaxDelayMs,
      "web.fetch.retryMaxDelayMs"
    )
  };
}
export {
  createWebFetchDefaults,
  createWebSearchDefaults,
  parseWebFetchConfig,
  parseWebSearchConfig,
  parseWebSearchFallback,
  parseWebSearchProviderName,
  prepareWebSearchInputs
};
