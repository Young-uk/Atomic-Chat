import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  runCommand as defaultRunCommand
} from "../../../sandbox/command-runner.mjs";
import { extractWebContent } from "./web-fetch-extract.mjs";
import { CurlUnavailableError, isCurlMissingError } from "./ensure-curl.mjs";
import { parseRetryAfterValueMs } from "./retry-after-header.mjs";
import { explainCurlStderr, runCurl } from "./run-curl.mjs";
import {
  assertHostAllowed,
  formatResolveEntry,
  parseHttpUrl,
  SsrfBlockedError
} from "./web-fetch-ssrf-guard.mjs";
const TOOL_NAME = "os.web.fetch";
const DEFAULT_TIMEOUT_MS = 3e4;
import { describeChallenge, detectChallenge } from "./web-fetch-challenge.mjs";
const MAX_RESPONSE_BYTES = 2e6;
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_CHARS = 5e4;
const MAX_CHARS_CAP = 5e4;
const DEFAULT_FETCH_CONFIG = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  connectTimeoutMs: 1e4,
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5e3
};
const RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 502, 503, 504]);
const CURL_EXIT_TIMEOUT = 28;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CURL_META_MARKER = "__ATOMIC_WEBFETCH_META__";
const REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function buildOsWebFetchTool(options = {}) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const fetchCfg = options.config?.web.fetch ?? DEFAULT_FETCH_CONFIG;
  const sleep = options.sleep ?? defaultSleep;
  return {
    name: TOOL_NAME,
    description: "Read a web page as readable markdown/text. Fetches via curl and extracts content: prefers Cloudflare 'Markdown for Agents' (Accept: text/markdown), then Mozilla Readability, then a basic tag-stripping fallback. GET only, no auth headers, no JavaScript (use browser.* for JS-heavy pages; a page that answers with a bot-protection challenge is reported as such, with browser.navigate named as the way through). Blocks private/internal addresses (SSRF) and re-validates each redirect hop. Retries transient failures (429/502/503/504, connection timeouts) with exponential backoff. Optional `timeoutMs` overrides the configured per-attempt budget. For raw API/JSON responses, custom headers, auth, or POST, use os.http.request instead.",
    readonly: true,
    untrustedOutput: "a web page",
    async run(rawArgs, ctx) {
      const args = parseArgs(rawArgs, fetchCfg.timeoutMs);
      let outcome;
      try {
        outcome = await fetchWithGuard(args.url, {
          runCommand,
          lookup: options.lookup,
          cwd: ctx.workingDir,
          signal: ctx.signal,
          fetchCfg,
          timeoutMs: args.timeoutMs,
          sleep
        });
      } catch (err) {
        return compressToolResult({
          tool: TOOL_NAME,
          status: "error",
          output: err.message,
          details: {
            url: args.url,
            blocked: err instanceof SsrfBlockedError
          }
        });
      }
      const challenge = detectChallenge({
        status: outcome.status,
        contentType: outcome.contentType,
        body: outcome.body
      });
      if (challenge.challenged) {
        return compressToolResult({
          tool: TOOL_NAME,
          status: "error",
          output: describeChallenge(
            outcome.finalUrl,
            outcome.status,
            challenge.marker ?? ""
          ),
          details: {
            url: args.url,
            finalUrl: outcome.finalUrl,
            status: outcome.status,
            challenge: challenge.marker,
            retryWith: "browser.navigate"
          }
        });
      }
      const extracted = extractWebContent({
        body: outcome.body,
        contentType: outcome.contentType,
        url: outcome.finalUrl,
        mode: args.mode
      });
      const capped = (ctx.modelMode !== "cloud" || rawArgs.maxChars !== void 0) && extracted.text.length > args.maxChars;
      const text = capped ? `${extracted.text.slice(0, args.maxChars)}
\u2026 [truncated]` : extracted.text;
      const isHttpError = outcome.status >= 400;
      const details = {
        url: args.url,
        finalUrl: outcome.finalUrl,
        status: outcome.status,
        contentType: outcome.contentType,
        extractor: extracted.extractor,
        title: extracted.title,
        redirectChain: outcome.redirectChain,
        extractMode: args.mode,
        truncated: outcome.truncated || capped,
        ...isHttpError ? { extractedText: text } : {}
      };
      return compressToolResult(
        {
          tool: TOOL_NAME,
          status: isHttpError ? "error" : "ok",
          output: isHttpError ? `HTTP ${outcome.status} for ${outcome.finalUrl}` : text,
          details
        },
        {
          maxSummaryLength: args.maxChars,
          maxTailLines: Number.MAX_SAFE_INTEGER
        }
      );
    }
  };
}
function parseArgs(rawArgs, defaultTimeoutMs) {
  const url = rawArgs.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`${TOOL_NAME}: \`url\` must be a non-empty string`);
  }
  const rawMode = rawArgs.extractMode;
  let mode = "markdown";
  if (rawMode !== void 0) {
    if (rawMode !== "markdown" && rawMode !== "text") {
      throw new Error(
        `${TOOL_NAME}: \`extractMode\` must be "markdown" or "text"`
      );
    }
    mode = rawMode;
  }
  let maxChars = DEFAULT_MAX_CHARS;
  if (typeof rawArgs.maxChars === "number" && Number.isFinite(rawArgs.maxChars)) {
    maxChars = Math.min(
      MAX_CHARS_CAP,
      Math.max(1, Math.trunc(rawArgs.maxChars))
    );
  }
  const timeoutMs = typeof rawArgs.timeoutMs === "number" && Number.isFinite(rawArgs.timeoutMs) ? Math.max(1, Math.trunc(rawArgs.timeoutMs)) : defaultTimeoutMs;
  return { url, mode, maxChars, timeoutMs };
}
class CurlFailedError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
    this.name = "CurlFailedError";
  }
}
async function fetchWithGuard(rawUrl, opts) {
  let currentUrl = parseHttpUrl(rawUrl);
  const chain = [];
  for (let hop = 0; ; hop++) {
    const res = await fetchHopWithRetry(currentUrl, opts);
    chain.push(currentUrl.toString());
    if (REDIRECT_STATUSES.has(res.status) && res.redirectUrl.length > 0) {
      if (hop >= MAX_REDIRECTS) {
        throw new Error(
          `${TOOL_NAME}: too many redirects (> ${MAX_REDIRECTS})`
        );
      }
      currentUrl = parseHttpUrl(res.redirectUrl);
      continue;
    }
    return {
      finalUrl: currentUrl.toString(),
      status: res.status,
      contentType: res.contentType,
      body: res.body,
      truncated: res.truncated,
      redirectChain: chain
    };
  }
}
async function fetchHopWithRetry(url, opts) {
  const { maxRetries } = opts.fetchCfg;
  for (let attempt = 0; ; attempt++) {
    const pinnedIps = await assertHostAllowed(url, { lookup: opts.lookup });
    let res = null;
    let failure = null;
    try {
      res = await curlOnce(url, pinnedIps, opts);
    } catch (err) {
      if (!(err instanceof CurlFailedError) || err.exitCode !== CURL_EXIT_TIMEOUT) {
        throw err;
      }
      failure = err;
    }
    const retryable = failure !== null || res !== null && RETRYABLE_STATUSES.has(res.status);
    if (!retryable || attempt >= maxRetries || opts.signal.aborted) {
      if (res !== null) return res;
      throw failure;
    }
    await opts.sleep(
      backoffDelayMs(attempt, res?.retryAfterMs ?? null, opts.fetchCfg),
      opts.signal
    );
  }
}
function backoffDelayMs(attempt, retryAfterMs, cfg) {
  const backoff = cfg.retryBaseDelayMs * 2 ** attempt;
  const chosen = retryAfterMs !== null ? retryAfterMs : backoff;
  return Math.min(cfg.retryMaxDelayMs, Math.max(0, chosen));
}
function defaultSleep(ms, signal) {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
async function curlOnce(url, pinnedIps, opts) {
  const curlArgs = buildCurlArgs(url, pinnedIps, opts);
  let result;
  try {
    result = await runCurl(opts.runCommand, curlArgs, {
      cwd: opts.cwd,
      // Outer guard sits just above curl's own `--max-time` so curl reports the
      // timeout itself (exit 28) instead of being killed by the runner.
      timeoutMs: opts.timeoutMs + 2e3,
      signal: opts.signal,
      maxOutputBytes: MAX_RESPONSE_BYTES + 1024
    });
  } catch (err) {
    if (isCurlMissingError(err)) throw new CurlUnavailableError();
    throw err;
  }
  if (result.exitCode !== 0) {
    throw new CurlFailedError(
      `${TOOL_NAME}: ${formatCurlError(result)}`,
      result.exitCode ?? -1
    );
  }
  return { ...parseCurlMeta(result.stdout), truncated: result.truncated };
}
function buildCurlArgs(url, pinnedIps, opts) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const connectTimeoutMs = Math.min(
    opts.fetchCfg.connectTimeoutMs,
    opts.timeoutMs
  );
  return [
    "-sS",
    // Send `[`, `]`, `{`, `}` in URLs literally. Without this curl reads them
    // as its own range/set glob syntax and fails with "bad range in URL".
    "--globoff",
    "--max-time",
    String(Math.ceil(opts.timeoutMs / 1e3)),
    // Fail fast on hosts that never complete a handshake instead of holding
    // the whole `--max-time` budget open for them.
    "--connect-timeout",
    String(Math.ceil(connectTimeoutMs / 1e3)),
    "--max-redirs",
    "0",
    "--resolve",
    formatResolveEntry(host, port, pinnedIps),
    // Advertise the encodings curl can actually undo, and undo them.
    // Without this, a server that compresses regardless of the request
    // hands back bytes the extractor reads as binary noise — and some
    // hosts behave differently for a client that claims no encoding
    // support at all, since no browser has looked like that in years.
    "--compressed",
    "-H",
    "Accept: text/markdown, text/html;q=0.9, */*;q=0.1",
    "-H",
    `User-Agent: ${USER_AGENT}`,
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-w",
    // `%{header_json}` is last on purpose: it is multi-line JSON that can
    // itself contain `|`, so every pipe-delimited field must precede it.
    // Requires curl >= 7.83; older curl emits the literal token, which
    // `parseCurlMeta` tolerates by yielding no Retry-After.
    `
${CURL_META_MARKER}%{http_code}|%{content_type}|%{redirect_url}|%{size_download}|%{header_json}`,
    "--",
    url.toString()
  ];
}
function parseCurlMeta(stdout) {
  const markerIdx = stdout.lastIndexOf(CURL_META_MARKER);
  if (markerIdx === -1) {
    return {
      status: 0,
      contentType: "",
      redirectUrl: "",
      body: stdout,
      retryAfterMs: null
    };
  }
  const body = stdout.slice(0, markerIdx).replace(/\n$/, "");
  const meta = stdout.slice(markerIdx + CURL_META_MARKER.length).trim();
  const parts = meta.split("|");
  const [statusStr = "", contentType = "", redirectUrl = ""] = parts;
  const headerJson = parts.slice(4).join("|");
  const status = Number.parseInt(statusStr, 10);
  return {
    status: Number.isFinite(status) ? status : 0,
    contentType: contentType.trim(),
    redirectUrl: redirectUrl.trim(),
    body,
    retryAfterMs: parseRetryAfterMs(headerJson)
  };
}
function parseRetryAfterMs(headerJson) {
  const trimmed = headerJson.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const entry = Object.entries(parsed).find(
    ([key]) => key.toLowerCase() === "retry-after"
  );
  const rawValue = entry?.[1];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== "string") return null;
  return parseRetryAfterValueMs(value);
}
function formatCurlError(result) {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) return explainCurlStderr(stderr);
  if (result.timedOut) return "curl timed out";
  return `curl exited with code ${result.exitCode}`;
}
export {
  buildOsWebFetchTool,
  parseCurlMeta
};
