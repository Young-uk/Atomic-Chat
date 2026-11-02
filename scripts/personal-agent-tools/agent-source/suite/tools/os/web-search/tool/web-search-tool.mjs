import { join } from "node:path";
import { compressToolResult } from "../../../../compressor/result-compressor.mjs";
import { runWebSearchWithFallback } from "../providers/index.mjs";
import { buildFallbackKeyHint } from "../providers/search-failure-report.mjs";
import {
  createPersistentProviderCooldown,
  createProviderCooldown
} from "../transport/provider-cooldown.mjs";
import {
  createPersistentSearchCache,
  createSearchCache
} from "../transport/search-cache.mjs";
import {
  WebSearchUnavailableError
} from "../web-search-errors.mjs";
import { checkMissingSearchKey } from "./warn-missing-search-key.mjs";
const TOOL_NAME = "os.web.search";
const MAX_RESULTS_CAP = 20;
const CACHE_FILE_NAME = "web-search-cache.json";
const COOLDOWN_FILE_NAME = "web-search-cooldown.json";
function buildOsWebSearchTool(options) {
  const cfg0 = options.config.web.search;
  const persistDir = cfg0.persistCache ? options.stateDir : void 0;
  const ttlMs = cfg0.cacheTtlMinutes * 6e4;
  const cache = persistDir === void 0 ? createSearchCache({ ttlMs }) : createPersistentSearchCache({
    ttlMs,
    filePath: join(persistDir, CACHE_FILE_NAME)
  });
  const cooldown = persistDir === void 0 ? createProviderCooldown() : createPersistentProviderCooldown({
    filePath: join(persistDir, COOLDOWN_FILE_NAME)
  });
  const missingKey = checkMissingSearchKey({
    config: options.config,
    env: options.env ?? process.env
  });
  if (missingKey) {
    const warn = options.warn ?? ((message) => process.stderr.write(`${message}
`));
    warn(missingKey.message);
  }
  const keyHintedSessions = /* @__PURE__ */ new Set();
  return {
    name: TOOL_NAME,
    description: "Search the web through the configured provider and return compact title/url/snippet results. Default provider is Exa (its free keyless tier, or an environment API key when set), with DuckDuckGo as the fallback; SearXNG is keyless, Brave needs an environment API key. Use os.web.fetch to read a chosen result page.",
    readonly: true,
    untrustedOutput: "web search results",
    async run(rawArgs, ctx) {
      const cfg = options.config.web.search;
      if (!cfg.enabled) {
        return compressToolResult({
          tool: TOOL_NAME,
          status: "error",
          output: "os.web.search is disabled by config (`web.search.enabled = false`).",
          details: { provider: cfg.provider }
        });
      }
      const args = parseArgs(rawArgs, cfg.maxResults);
      try {
        const outcome = await runWebSearchWithFallback({
          config: options.config,
          deps: {
            runCommand: options.runCommand,
            lookup: options.lookup
          },
          options: {
            query: args.query,
            maxResults: args.maxResults,
            timeoutMs: cfg.timeoutMs,
            cwd: ctx.workingDir,
            signal: ctx.signal
          },
          cache,
          cooldown,
          ...options.keyHelp === void 0 ? {} : { keyHelp: options.keyHelp }
        });
        return compressToolResult(
          {
            tool: TOOL_NAME,
            status: "ok",
            output: renderNotes(outcome.degraded) + renderKeyHint(
              buildFallbackKeyHint(options.keyHelp, outcome.keyRequired),
              keyHintedSessions,
              ctx.sessionId
            ) + renderResults(outcome.results),
            details: {
              provider: outcome.provider,
              fromCache: outcome.fromCache,
              query: args.query,
              results: outcome.results,
              ...outcome.degraded.length > 0 ? { degraded: outcome.degraded } : {},
              // Keyless Exa hit its free limit; a host renders a key card
              // from this (ATO-327, `WebSearchKeyRequired`).
              ...outcome.keyRequired ? { keyRequired: outcome.keyRequired } : {}
            }
          },
          {
            maxSummaryLength: 12e3,
            maxTailLines: Number.MAX_SAFE_INTEGER
          }
        );
      } catch (err) {
        const unavailable = err instanceof WebSearchUnavailableError ? err : void 0;
        return compressToolResult(
          {
            tool: TOOL_NAME,
            status: "error",
            output: err.message,
            details: {
              provider: cfg.provider,
              query: args.query,
              ...unavailable ? { failures: unavailable.failures } : {},
              // `WebSearchKeyRequired`: a free Exa key would fix this.
              ...unavailable?.keyRequired ? { keyRequired: unavailable.keyRequired } : {}
            }
          },
          unavailable ? { maxSummaryLength: 2e3 } : {}
        );
      }
    }
  };
}
function parseArgs(rawArgs, defaultMaxResults) {
  const query = rawArgs.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error(`${TOOL_NAME}: \`query\` must be a non-empty string`);
  }
  let maxResults = defaultMaxResults;
  if (typeof rawArgs.maxResults === "number" && Number.isFinite(rawArgs.maxResults)) {
    maxResults = Math.trunc(rawArgs.maxResults);
  }
  maxResults = Math.min(MAX_RESULTS_CAP, Math.max(1, maxResults));
  return { query: query.trim(), maxResults };
}
function renderNotes(degraded) {
  if (degraded.length === 0) return "";
  return `${degraded.map((note) => `[search] ${note}`).join("\n")}

`;
}
function renderKeyHint(hint, hintedSessions, sessionId) {
  if (hint === void 0 || hintedSessions.has(sessionId)) return "";
  hintedSessions.add(sessionId);
  return `[search] ${hint}

`;
}
function renderResults(results) {
  if (results.length === 0) return "No search results.";
  return results.map((result, index) => {
    const lines = [`${index + 1}. ${result.title}`, `URL: ${result.url}`];
    if (result.published) lines.push(`Published: ${result.published}`);
    if (result.snippet) lines.push(`Snippet: ${result.snippet}`);
    return lines.join("\n");
  }).join("\n\n");
}
export {
  buildOsWebSearchTool
};
