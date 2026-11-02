import {
  runCommand as defaultRunCommand
} from "../../../../sandbox/command-runner.mjs";
import {
  assertHostAllowed,
  formatResolveEntry,
  parseHttpUrl
} from "../../web/web-fetch-ssrf-guard.mjs";
import { CurlUnavailableError, isCurlMissingError } from "../../web/ensure-curl.mjs";
import { explainCurlStderr, runCurl } from "../../web/run-curl.mjs";
import {
  computeRetryDelayMs,
  DEFAULT_SEARCH_RETRY_POLICY,
  parseRetryAfterMs
} from "./retry-after.mjs";
const CURL_META_MARKER = "__ATOMIC_WEB_SEARCH_META__";
const CURL_HEADER_MARKER = "__ATOMIC_WEB_SEARCH_HEADERS__";
const DEFAULT_MAX_RESPONSE_BYTES = 1e6;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
const CONNECT_TIMEOUT_MS = 5e3;
async function searchHttp(request) {
  const policy = request.retryPolicy ?? DEFAULT_SEARCH_RETRY_POLICY;
  const sleep = request.sleep ?? defaultSleep;
  const now = request.now ?? Date.now;
  for (let attempt = 0; ; attempt++) {
    const { retryAfter, ...rest } = await sendOnce(request);
    const retryAfterMs = parseRetryAfterMs(retryAfter, now());
    const response = { ...rest, retryAfterMs };
    if (response.status !== 429 || attempt >= policy.maxRetries) {
      return response;
    }
    const delayMs = computeRetryDelayMs({
      attempt: attempt + 1,
      policy,
      retryAfterMs
    });
    await sleep(delayMs, request.signal);
    if (request.signal?.aborted) return response;
  }
}
async function sendOnce(request) {
  const runCommand = request.runCommand ?? defaultRunCommand;
  const method = request.method ?? "GET";
  let currentUrl = parseHttpUrl(request.url);
  const chain = [];
  for (let hop = 0; ; hop++) {
    const pinnedIps = await assertHostAllowed(currentUrl, {
      lookup: request.lookup
    });
    const curlArgs = buildCurlArgs({
      url: currentUrl,
      pinnedIps,
      method,
      headers: request.headers ?? {},
      hasBody: request.body !== void 0,
      timeoutMs: request.timeoutMs
    });
    let result;
    try {
      result = await runCurl(runCommand, curlArgs, {
        cwd: request.cwd,
        timeoutMs: request.timeoutMs + 2e3,
        signal: request.signal,
        input: request.body,
        maxOutputBytes: (request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) + 1024
      });
    } catch (err) {
      if (isCurlMissingError(err)) throw new CurlUnavailableError();
      throw err;
    }
    if (result.exitCode !== 0) {
      throw new Error(formatCurlError(result));
    }
    const response = {
      ...parseCurlMeta(result.stdout),
      truncated: result.truncated
    };
    chain.push(currentUrl.toString());
    if (REDIRECT_STATUSES.has(response.status) && response.redirectUrl.length > 0) {
      if (hop >= MAX_REDIRECTS) {
        throw new Error(`too many redirects (> ${MAX_REDIRECTS})`);
      }
      currentUrl = parseHttpUrl(response.redirectUrl);
      continue;
    }
    return {
      finalUrl: currentUrl.toString(),
      status: response.status,
      contentType: response.contentType,
      body: response.body,
      truncated: response.truncated,
      redirectChain: chain,
      retryAfter: response.retryAfter
    };
  }
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
function buildCurlArgs(input) {
  const host = input.url.hostname.replace(/^\[|\]$/g, "");
  const port = input.url.port || (input.url.protocol === "https:" ? "443" : "80");
  const args = [
    "-sS",
    // Send `[`, `]`, `{`, `}` in URLs literally. Without this curl reads them
    // as its own range/set glob syntax and fails with "bad range in URL".
    "--globoff",
    "--max-time",
    String(Math.ceil(input.timeoutMs / 1e3)),
    "--connect-timeout",
    String(Math.ceil(Math.min(CONNECT_TIMEOUT_MS, input.timeoutMs) / 1e3)),
    "--max-redirs",
    "0",
    "--resolve",
    formatResolveEntry(host, port, input.pinnedIps),
    "-H",
    `User-Agent: ${USER_AGENT}`,
    "-H",
    "Accept-Language: en-US,en;q=0.9"
  ];
  for (const [key, value] of Object.entries(input.headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (input.method === "POST" || input.hasBody) {
    args.push("-X", input.method, "--data-binary", "@-");
  }
  args.push(
    "-w",
    `
${CURL_META_MARKER}%{http_code}|%{content_type}|%{redirect_url}|%{size_download}|${CURL_HEADER_MARKER}%header{retry-after}`,
    "--",
    input.url.toString()
  );
  return args;
}
function parseCurlMeta(stdout) {
  const markerIdx = stdout.lastIndexOf(CURL_META_MARKER);
  if (markerIdx === -1) {
    return {
      status: 0,
      contentType: "",
      redirectUrl: "",
      retryAfter: "",
      body: stdout
    };
  }
  const body = stdout.slice(0, markerIdx).replace(/\n$/, "");
  const meta = stdout.slice(markerIdx + CURL_META_MARKER.length).trim();
  const [statusStr = "", contentType = "", redirectUrl = ""] = meta.split("|");
  const status = Number.parseInt(statusStr, 10);
  const headerIdx = meta.indexOf(CURL_HEADER_MARKER);
  const retryAfter = headerIdx === -1 ? "" : meta.slice(headerIdx + CURL_HEADER_MARKER.length).trim();
  return {
    status: Number.isFinite(status) ? status : 0,
    contentType: contentType.trim(),
    redirectUrl: redirectUrl.trim(),
    retryAfter: retryAfter.startsWith("%header{") ? "" : retryAfter,
    body
  };
}
function formatCurlError(result) {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) return explainCurlStderr(stderr);
  if (result.timedOut) return "curl timed out";
  return `curl exited with code ${result.exitCode}`;
}
export {
  parseCurlMeta,
  searchHttp
};
