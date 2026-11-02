import {
  runCommand as defaultRunCommand
} from "../../../sandbox/command-runner.mjs";
import { CurlUnavailableError, isCurlMissingError } from "./ensure-curl.mjs";
import { parseRetryAfterValueMs } from "./retry-after-header.mjs";
import { explainCurlStderr, runCurl } from "./run-curl.mjs";
import {
  assertHostAllowed,
  formatResolveEntry,
  parseHttpUrl,
  SsrfBlockedError
} from "./web-fetch-ssrf-guard.mjs";
const CURL_META_MARKER = "__ATOMIC_CURL_META__";
const CURL_RETRY_AFTER_MARKER = "__ATOMIC_CURL_RA__";
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 502, 503, 504]);
const INVITED_RETRY_STATUSES = /* @__PURE__ */ new Set([429, 503]);
const CURL_EXIT_TIMEOUT = 28;
const IDEMPOTENT_METHODS = /* @__PURE__ */ new Set(["GET"]);
const DEFAULT_HTTP_RETRY_CONFIG = {
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5e3
};
async function executeGuardedHttpRequest(rawUrl, args, opts) {
  const retry = opts.retry ?? DEFAULT_HTTP_RETRY_CONFIG;
  const sleep = opts.sleep ?? defaultSleep;
  const state = {
    url: rawUrl,
    method: args.method,
    body: args.body,
    chain: [],
    redirects: 0,
    totalTime: 0,
    truncated: false
  };
  for (let attempt = 0; ; attempt++) {
    let response = null;
    let failure = null;
    try {
      response = await sendGuardedRequestOnce(args, opts, state);
    } catch (err) {
      if (!isCurlTransportError(err) || err.exitCode !== CURL_EXIT_TIMEOUT) {
        throw err;
      }
      failure = err;
    }
    const exhausted = attempt >= retry.maxRetries || opts.signal.aborted;
    if (exhausted || !isRetryableAttempt(state.method, response, failure)) {
      if (response !== null) return response;
      throw failure;
    }
    await sleep(
      httpBackoffDelayMs(attempt, response?.retryAfterMs ?? null, retry),
      opts.signal
    );
    if (opts.signal.aborted) {
      if (response !== null) return response;
      throw failure;
    }
  }
}
function isRetryableAttempt(method, response, failure) {
  const idempotent = IDEMPOTENT_METHODS.has(method);
  if (failure !== null) return idempotent;
  if (response === null) return false;
  if (!RETRYABLE_STATUSES.has(response.status)) return false;
  if (idempotent) return true;
  return INVITED_RETRY_STATUSES.has(response.status) && response.retryAfterMs !== null;
}
function httpBackoffDelayMs(attempt, retryAfterMs, cfg) {
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
async function sendGuardedRequestOnce(args, opts, state) {
  const runCommand = opts.runCommand ?? defaultRunCommand;
  let currentUrl = parseHttpUrl(state.url);
  let method = state.method;
  let body = state.body;
  const chain = state.chain;
  let lastCommand = [];
  for (; ; ) {
    const pinnedIps = await assertHostAllowed(currentUrl, {
      lookup: opts.lookup
    });
    const curlArgs = buildPinnedCurlArgs({
      url: currentUrl,
      pinnedIps,
      method,
      headers: args.headers,
      body,
      timeoutMs: args.timeoutMs
    });
    lastCommand = ["curl", ...curlArgs];
    state.url = currentUrl.toString();
    state.method = method;
    state.body = body;
    let result;
    try {
      result = await runCurl(runCommand, curlArgs, {
        cwd: opts.cwd,
        timeoutMs: args.timeoutMs + 2e3,
        signal: opts.signal,
        maxOutputBytes: opts.maxResponseBytes + 1024,
        input: body
      });
    } catch (err) {
      if (isCurlMissingError(err)) throw new CurlUnavailableError();
      throw err;
    }
    if (result.exitCode !== 0) {
      const err = new Error(formatCurlError(result));
      err.curlExit = true;
      err.command = lastCommand;
      err.exitCode = result.exitCode;
      err.stderr = result.stderr.trim();
      throw err;
    }
    const parsed = parseCurlOutput(result.stdout);
    state.truncated = state.truncated || result.truncated;
    state.totalTime += parsed.timeTotal;
    chain.push(currentUrl.toString());
    const shouldFollow = args.followRedirects && REDIRECT_STATUSES.has(parsed.status) && parsed.redirectUrl.length > 0;
    if (shouldFollow) {
      if (state.redirects >= MAX_REDIRECTS) {
        throw new Error(
          `os.http.request: too many redirects (> ${MAX_REDIRECTS})`
        );
      }
      state.redirects += 1;
      if (parsed.status === 301 || parsed.status === 302 || parsed.status === 303) {
        method = "GET";
        body = void 0;
      }
      currentUrl = parseHttpUrl(parsed.redirectUrl);
      continue;
    }
    return {
      finalUrl: currentUrl.toString(),
      status: parsed.status,
      contentType: parsed.contentType,
      body: parsed.body,
      sizeDownload: parsed.sizeDownload,
      timeTotal: state.totalTime,
      truncated: state.truncated,
      redirectChain: [...chain],
      retryAfterMs: parseRetryAfterValueMs(parsed.retryAfter),
      command: lastCommand
    };
  }
}
function isCurlTransportError(err) {
  return err instanceof Error && err.curlExit === true;
}
function buildPinnedCurlArgs(input) {
  const host = input.url.hostname.replace(/^\[|\]$/g, "");
  const port = input.url.port || (input.url.protocol === "https:" ? "443" : "80");
  const argv = [
    "-sS",
    // Send `[`, `]`, `{`, `}` in URLs literally. Without this curl reads them
    // as its own range/set glob syntax and fails with "bad range in URL".
    "--globoff",
    "--max-time",
    String(Math.ceil(input.timeoutMs / 1e3)),
    // Hop-by-hop follow is owned by executeGuardedHttpRequest so each
    // Location can be re-validated. Never bare `-L` here.
    "--max-redirs",
    "0",
    "--resolve",
    formatResolveEntry(host, port, input.pinnedIps)
  ];
  if (input.method !== "GET") argv.push("-X", input.method);
  for (const [key, value] of Object.entries(input.headers)) {
    argv.push("-H", `${key}: ${value}`);
  }
  if (input.body !== void 0) {
    argv.push("--data-binary", "@-");
  }
  argv.push(
    "-w",
    `
${CURL_META_MARKER}%{http_code}|%{content_type}|%{size_download}|%{time_total}|%{redirect_url}${CURL_RETRY_AFTER_MARKER}%header{retry-after}`
  );
  argv.push("--", input.url.toString());
  return argv;
}
function parseCurlOutput(stdout) {
  const markerIdx = stdout.lastIndexOf(CURL_META_MARKER);
  if (markerIdx === -1) {
    return {
      body: stdout,
      status: 0,
      contentType: "",
      sizeDownload: stdout.length,
      timeTotal: 0,
      redirectUrl: "",
      retryAfter: ""
    };
  }
  const body = stdout.slice(0, markerIdx).replace(/\n$/, "");
  const meta = stdout.slice(markerIdx + CURL_META_MARKER.length).trim();
  const raIdx = meta.indexOf(CURL_RETRY_AFTER_MARKER);
  const head = raIdx === -1 ? meta : meta.slice(0, raIdx);
  const retryAfterRaw = raIdx === -1 ? "" : meta.slice(raIdx + CURL_RETRY_AFTER_MARKER.length);
  const [
    statusStr = "",
    contentType = "",
    sizeStr = "",
    timeStr = "",
    ...redirectRest
  ] = head.split("|");
  const redirectUrl = redirectRest.join("|");
  const status = Number.parseInt(statusStr, 10);
  const sizeDownload = Number.parseInt(sizeStr, 10);
  const timeTotal = Number.parseFloat(timeStr);
  const retryAfter = retryAfterRaw.trim();
  return {
    body,
    status: Number.isFinite(status) ? status : 0,
    contentType: contentType.trim(),
    sizeDownload: Number.isFinite(sizeDownload) ? sizeDownload : body.length,
    timeTotal: Number.isFinite(timeTotal) ? timeTotal : 0,
    redirectUrl: redirectUrl.trim(),
    retryAfter: retryAfter.startsWith("%header{") ? "" : retryAfter
  };
}
function formatCurlError(result) {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) return explainCurlStderr(stderr);
  if (result.timedOut) return "curl timed out";
  return `curl exited with code ${result.exitCode}`;
}
export {
  CURL_META_MARKER,
  CURL_RETRY_AFTER_MARKER,
  DEFAULT_HTTP_RETRY_CONFIG,
  SsrfBlockedError,
  executeGuardedHttpRequest,
  isCurlTransportError,
  parseCurlOutput
};
