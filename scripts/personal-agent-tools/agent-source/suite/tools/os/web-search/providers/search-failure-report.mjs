import {
  formatCooldown
} from "../transport/provider-cooldown.mjs";
import {
  DEFAULT_EXA_KEY_ENV,
  EXA_GET_KEY_URL,
  WebSearchRateLimitedError
} from "../web-search-errors.mjs";
const CONNECT_FAILURE = /curl: \((?:6|7|35)\)|could not resolve host|failed to connect|connection timed out|connection refused|resolving timed out|DNS resolution failed/i;
const TIMEOUT_FAILURE = /curl: \(28\)|timed out/i;
function isConnectFailure(err) {
  return CONNECT_FAILURE.test(errorMessage(err));
}
const DNS_FAILURE = /curl: \(6\)|could not resolve host|DNS resolution failed|resolving timed out/i;
function connectReason(raw) {
  if (DNS_FAILURE.test(raw)) {
    return "the site's name could not be looked up (DNS)";
  }
  if (/curl: \(35\)/i.test(raw)) {
    return "the secure connection (TLS) failed";
  }
  if (/connection timed out|curl: \(28\)/i.test(raw)) {
    const seconds = timeoutSeconds(raw);
    return seconds === void 0 ? "the connection timed out" : `the connection timed out after ${seconds} s`;
  }
  if (/refused/i.test(raw)) return "the connection was refused";
  if (/network is unreachable|no route to host/i.test(raw)) {
    return "the network could not reach the site";
  }
  return "the connection failed";
}
function timeoutSeconds(raw) {
  const match = /after (\d+) (?:milliseconds|ms)\b/i.exec(raw);
  if (!match) return void 0;
  return Math.round(Number(match[1]) / 1e3);
}
function describeFailure(name, err, keylessExa) {
  const raw = errorMessage(err);
  if (err instanceof WebSearchRateLimitedError) {
    return keylessExa ? `${name}: free limit reached (HTTP 429)` : `${name}: rate limited (HTTP 429)`;
  }
  if (isConnectFailure(err)) {
    return `${name}: could not connect, ${connectReason(raw)} (site unreachable from this network); ${raw}`;
  }
  if (TIMEOUT_FAILURE.test(raw)) {
    const seconds = timeoutSeconds(raw);
    const inTime = seconds === void 0 ? "in time" : `in ${seconds} s`;
    return `${name}: timed out (connected, but no answer ${inTime}); ${raw}`;
  }
  return `${name}: ${raw}`;
}
function exaKeyRequired(reason, envVar) {
  return { provider: "exa", reason, getKeyUrl: EXA_GET_KEY_URL, envVar };
}
function keyReasonOf(err) {
  if (err instanceof WebSearchRateLimitedError) return "rate_limited";
  return isConnectFailure(err) ? "unreachable" : "missing";
}
function describeUnusable(name, search) {
  if (name === "brave") return `no ${search.brave.apiKeyEnv} set`;
  if (name === "searxng") return "no `web.search.searxng.instanceUrl` set";
  return "not configured";
}
function parkedSkipLines(name, reason, parkedMs, freeTier) {
  const wait = formatCooldown(parkedMs);
  if (reason === "unreachable") {
    return {
      note: `${name} skipped: could not connect a moment ago, retrying in ${wait}`,
      failure: `${name}: could not connect a moment ago (site unreachable from this network), next try in ${wait}`
    };
  }
  const what = freeTier ? "free limit reached" : "rate limited";
  return {
    note: `${name} skipped: ${what}, retrying in ${wait}`,
    failure: `${name}: ${what}, next try in ${wait}`
  };
}
function rateLimitedNote(name, parkedMs, freeTier, envVar) {
  const wait = formatCooldown(parkedMs);
  return freeTier ? `${name} free limit reached (HTTP 429, no ${envVar}), parked for ${wait}` : `${name} rate limited (HTTP 429), parked for ${wait}`;
}
function unreachableNote(name, parkedMs, raw) {
  return `${name} could not connect, skipped for ${formatCooldown(parkedMs)}: ${raw}`;
}
function buildUnavailableMessage(input) {
  const lines = [
    "Web search is unavailable: no search provider answered.",
    ...input.failures.map((line) => `- ${line}`)
  ];
  if (input.allUnreachable) {
    lines.push(
      "None of the search sites could be reached: check the internet connection, VPN or proxy."
    );
  }
  if (input.keyRequired && usesIntegrationsHub(input.keyHelp, input.keyRequired)) {
    lines.push(integrationsHubKeyAdvice(input.keyRequired));
  } else if (input.keyRequired) {
    const envVar = input.keyRequired.envVar;
    lines.push(
      `To fix it: get a free Exa API key at ${EXA_GET_KEY_URL} and add it. In the desktop app, paste it into the key card in the chat or in Settings. In the terminal, add \`${envVar}=...\` to the agent's .env file (~/.atomic-agent/.env, or $ATOMIC_AGENT_STATE_DIR/.env) and restart the agent.`
    );
  } else {
    lines.push(
      "To fix it: check the network, or choose another provider in `web.search.provider`: `brave` (with its API key in the env) or `searxng` (with `web.search.searxng.instanceUrl`)."
    );
  }
  lines.push(
    "Do not repeat this search. Answer without web search and tell the user that web search is not available right now."
  );
  return lines.join("\n");
}
function usesIntegrationsHub(keyHelp, keyRequired) {
  return keyHelp === "integrations-hub" && keyRequired.envVar === DEFAULT_EXA_KEY_ENV;
}
function integrationsHubKeyAdvice(keyRequired) {
  const action = `Open /integrations in the terminal app and add an Exa key (${keyRequired.getKeyUrl}).`;
  return keyRequired.reason === "rate_limited" ? `Free Exa searches ran out. ${action}` : `To fix it: ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
}
function buildFallbackKeyHint(keyHelp, keyRequired) {
  if (keyHelp !== "integrations-hub") return void 0;
  if (keyRequired?.reason !== "rate_limited") return void 0;
  if (usesIntegrationsHub(keyHelp, keyRequired)) {
    return `Free Exa searches ran out. Tell the user: open /integrations in the terminal app and add an Exa key (${keyRequired.getKeyUrl}).`;
  }
  return `Free Exa searches ran out. Tell the user: get a free Exa API key at ${keyRequired.getKeyUrl}, add \`${keyRequired.envVar}=...\` to the agent's .env file and restart the agent.`;
}
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
export {
  buildFallbackKeyHint,
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
};
