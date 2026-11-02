import {
  buildSearchCacheKey
} from "../transport/search-cache.mjs";
import {
  WebSearchBlockedError,
  WebSearchRateLimitedError,
  WebSearchUnavailableError
} from "../web-search-errors.mjs";
import { resolveProviderByName } from "./provider-registry.mjs";
import {
  buildUnavailableMessage,
  describeFailure,
  describeUnusable,
  errorMessage,
  exaKeyRequired,
  isConnectFailure,
  keyReasonOf,
  parkedSkipLines,
  rateLimitedNote,
  unreachableNote
} from "./search-failure-report.mjs";
async function runWebSearchWithFallback(input) {
  const search = input.config.web.search;
  const env = input.env ?? process.env;
  const chain = buildProviderChain(search, env);
  const now = input.now ?? Date.now;
  const cooldown = input.cooldown;
  let lastEmpty;
  const degraded = [];
  const failures = [];
  const skipped = [];
  let connectFailures = 0;
  const keylessExa = chain.includes("exa") && !hasEnvKey(env, search.exa.apiKeyEnv);
  let exaOutcome;
  const keyRequired = (reason) => exaKeyRequired(reason, search.exa.apiKeyEnv);
  const finish = (result) => keylessExa && exaOutcome === "rate_limited" ? { ...result, keyRequired: keyRequired("rate_limited") } : result;
  const exaTier = keylessExa ? "keyless" : "keyed";
  const parkedTier = chain.includes("exa") ? cooldown?.tagOf("exa") : null;
  if (parkedTier && parkedTier !== exaTier) cooldown?.clear("exa");
  let probeUnreachable = chain.filter((n) => isProviderUsable(n, input.config, env)).every((n) => cooldown?.reasonOf(n, now()) === "unreachable");
  for (const name of chain) {
    if (!isProviderUsable(name, input.config, env)) {
      skipped.push(`${name}: skipped (${describeUnusable(name, search)})`);
      continue;
    }
    const tier = name === "exa" ? exaTier : void 0;
    const parkedFor = cooldown?.remainingMs(name, now()) ?? 0;
    const cacheKey = buildSearchCacheKey(
      name,
      input.options.query,
      input.options.maxResults
    );
    const cached = input.cache?.get(cacheKey);
    if (cached) {
      if (cached.length > 0) {
        return finish({
          results: cached,
          provider: name,
          fromCache: true,
          degraded
        });
      }
      lastEmpty = {
        results: cached,
        provider: name,
        fromCache: true,
        degraded
      };
      continue;
    }
    let parked = parkedFor > 0 ? cooldown?.reasonOf(name, now()) : void 0;
    if (parked === "unreachable" && probeUnreachable) {
      probeUnreachable = false;
      if (cooldown?.takeProbe(name, now())) parked = void 0;
    }
    if (parked !== void 0) {
      const freeTier = keylessExa && name === "exa";
      const lines = parkedSkipLines(name, parked, parkedFor, freeTier);
      degraded.push(lines.note);
      failures.push(lines.failure);
      if (parked === "unreachable") connectFailures++;
      if (freeTier) exaOutcome = parked;
      continue;
    }
    const provider = resolveProviderByName(name, input.config, input.deps);
    try {
      const results = await provider.search(input.options);
      input.cache?.set(cacheKey, results);
      cooldown?.clear(name);
      if (results.length > 0) {
        return finish({ results, provider: name, fromCache: false, degraded });
      }
      lastEmpty = { results, provider: name, fromCache: false, degraded };
    } catch (err) {
      if (input.options.signal.aborted) throw err;
      const freeTier = keylessExa && name === "exa";
      failures.push(describeFailure(name, err, freeTier));
      if (isConnectFailure(err)) connectFailures++;
      if (freeTier) exaOutcome = keyReasonOf(err);
      if (err instanceof WebSearchRateLimitedError && cooldown) {
        const parkedMs = cooldown.park(name, now(), err.retryAfterMs, tier);
        degraded.push(
          rateLimitedNote(name, parkedMs, freeTier, search.exa.apiKeyEnv)
        );
      } else if (isConnectFailure(err) && cooldown) {
        const parkedMs = cooldown.parkUnreachable(name, now(), tier);
        degraded.push(unreachableNote(name, parkedMs, errorMessage(err)));
      } else {
        degraded.push(`${name} failed: ${errorMessage(err)}`);
      }
    }
  }
  if (lastEmpty) return finish(lastEmpty);
  if (failures.length > 0) {
    const signal = keylessExa ? keyRequired(exaOutcome ?? "missing") : void 0;
    const report = [...failures, ...skipped];
    throw new WebSearchUnavailableError(
      search.provider,
      buildUnavailableMessage({
        failures: report,
        keyRequired: signal,
        allUnreachable: connectFailures > 0 && connectFailures === failures.length,
        keyHelp: input.keyHelp
      }),
      report,
      signal
    );
  }
  throw new WebSearchBlockedError(
    search.provider,
    `no usable web search provider (checked ${chain.join(", ")})`
  );
}
function buildProviderChain(search, env) {
  const seen = /* @__PURE__ */ new Set();
  const chain = [];
  for (const name of [search.provider, ...search.fallback]) {
    if (seen.has(name)) continue;
    seen.add(name);
    chain.push(name);
  }
  if (seen.has("exa") && !hasEnvKey(env, search.exa.apiKeyEnv) && !seen.has("duckduckgo")) {
    chain.push("duckduckgo");
  }
  return chain;
}
function isProviderUsable(name, config, env) {
  const search = config.web.search;
  switch (name) {
    case "searxng":
      return Boolean(search.searxng.instanceUrl);
    case "brave": {
      const key = env[search.brave.apiKeyEnv];
      return typeof key === "string" && key.length > 0;
    }
    case "exa":
    case "duckduckgo":
      return true;
  }
}
function hasEnvKey(env, name) {
  const key = env[name]?.trim();
  return typeof key === "string" && key.length > 0;
}
export {
  runWebSearchWithFallback
};
