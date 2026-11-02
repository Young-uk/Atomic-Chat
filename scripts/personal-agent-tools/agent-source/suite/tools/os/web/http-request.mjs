import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  runCommand as defaultRunCommand
} from "../../../sandbox/command-runner.mjs";
import {
  requireApproval
} from "../../../approval/dangerous-tool.mjs";
import { CurlUnavailableError } from "./ensure-curl.mjs";
import {
  executeGuardedHttpRequest,
  isCurlTransportError,
  SsrfBlockedError
} from "./http-request-fetch.mjs";
import { parseCurlOutput } from "./http-request-fetch.mjs";
function buildOsHttpRequestTool(options) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  return {
    name: "os.http.request",
    untrustedOutput: "an HTTP response",
    description: "Raw HTTP GET or POST via the system `curl` binary for APIs and machine-readable endpoints (JSON, XML, plain text). Returns the response body verbatim \u2014 no HTML extraction or cleanup. To read a human web page as markdown/text, use `os.web.fetch` instead. Blocks private/internal addresses (SSRF) like `os.web.fetch`, pins DNS with curl `--resolve`, and re-validates each redirect hop. Host allowlist and approval policy come from `config.http`. Body is capped at `config.http.maxResponseBytes`. Retries transient failures (429/502/503/504 and connection timeouts) with exponential backoff, honouring `Retry-After`; a POST is only retried when the server explicitly invites it, so a request is never double-submitted.",
    readonly: false,
    async run(rawArgs, ctx) {
      const httpCfg = options.config.http;
      if (!httpCfg.enabled) {
        throw new Error(
          "os.http.request: disabled by config (`http.enabled = false`)."
        );
      }
      const args = parseArgs(rawArgs, httpCfg.defaultTimeoutMs);
      if (!hostAllowed(args.urlObj.hostname, httpCfg.hostAllowlist)) {
        throw new Error(
          `os.http.request: host ${args.urlObj.hostname} is not in config.http.hostAllowlist`
        );
      }
      if (needsApproval(httpCfg.approvalMode, args.method)) {
        await requireApproval(
          options,
          {
            sessionId: ctx.sessionId,
            tool: "os.http.request",
            category: "http",
            reason: `${args.method} ${args.url}`,
            preview: buildApprovalPreview(args),
            affectedResources: [args.url]
          },
          ctx.signal
        );
      }
      let guarded;
      try {
        guarded = await executeGuardedHttpRequest(
          args.url,
          {
            method: args.method,
            headers: args.headers,
            body: args.body,
            timeoutMs: args.timeoutMs,
            followRedirects: args.followRedirects
          },
          {
            runCommand,
            lookup: options.lookup,
            cwd: ctx.workingDir,
            signal: ctx.signal,
            maxResponseBytes: httpCfg.maxResponseBytes
          }
        );
      } catch (err) {
        if (err instanceof CurlUnavailableError) {
          return compressToolResult({
            tool: "os.http.request",
            status: "error",
            output: err.message,
            details: { url: args.url, method: args.method }
          });
        }
        if (err instanceof SsrfBlockedError) {
          return compressToolResult({
            tool: "os.http.request",
            status: "error",
            output: err.message,
            details: {
              url: args.url,
              method: args.method,
              blocked: true,
              host: err.host
            }
          });
        }
        if (isCurlTransportError(err)) {
          return compressToolResult({
            tool: "os.http.request",
            status: "error",
            output: err.message,
            details: {
              exitCode: err.exitCode,
              stderr: err.stderr,
              url: args.url,
              method: args.method,
              command: err.command
            }
          });
        }
        throw err;
      }
      const isHttpError = guarded.status >= 400;
      return compressToolResult(
        {
          tool: "os.http.request",
          status: isHttpError ? "error" : "ok",
          output: isHttpError ? `HTTP ${guarded.status} ${args.method} ${guarded.finalUrl}` : guarded.body,
          details: {
            url: args.url,
            finalUrl: guarded.finalUrl,
            method: args.method,
            status: guarded.status,
            contentType: guarded.contentType,
            sizeDownload: guarded.sizeDownload,
            timeTotalSeconds: guarded.timeTotal,
            truncated: guarded.truncated,
            redirectChain: guarded.redirectChain,
            command: guarded.command,
            ...isHttpError ? { body: guarded.body } : {}
          }
        },
        {
          maxSummaryLength: httpCfg.maxResponseBytes,
          maxTailLines: Number.MAX_SAFE_INTEGER
        }
      );
    }
  };
}
function parseArgs(rawArgs, defaultTimeoutMs) {
  const url = rawArgs.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("os.http.request: `url` must be a non-empty string");
  }
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    throw new Error(`os.http.request: invalid URL ${JSON.stringify(url)}`);
  }
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    throw new Error(
      `os.http.request: only http/https URLs are supported (got ${urlObj.protocol})`
    );
  }
  const rawMethod = typeof rawArgs.method === "string" ? rawArgs.method.toUpperCase() : "GET";
  if (rawMethod !== "GET" && rawMethod !== "POST") {
    throw new Error(
      `os.http.request: only GET and POST are supported (got ${JSON.stringify(rawArgs.method)})`
    );
  }
  const method = rawMethod;
  const headers = {};
  const rawHeaders = rawArgs.headers;
  if (rawHeaders !== void 0 && rawHeaders !== null) {
    if (typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) {
      throw new Error(
        "os.http.request: `headers` must be an object of string key/value pairs"
      );
    }
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof key !== "string" || key.length === 0) continue;
      if (typeof value !== "string") {
        throw new Error(
          `os.http.request: header ${JSON.stringify(key)} must be a string`
        );
      }
      if (key.includes("\n") || key.includes("\r") || value.includes("\n") || value.includes("\r")) {
        throw new Error(
          `os.http.request: header ${JSON.stringify(key)} contains CR/LF which is not allowed`
        );
      }
      headers[key] = value;
    }
  }
  if (!hasHeader(headers, "accept")) {
    headers["Accept"] = "application/json, text/event-stream";
  }
  let body;
  const rawBody = rawArgs.body;
  if (rawBody !== void 0 && rawBody !== null) {
    if (typeof rawBody === "string") {
      body = rawBody;
    } else if (typeof rawBody === "object") {
      body = JSON.stringify(rawBody);
      if (!hasHeader(headers, "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      throw new Error(
        "os.http.request: `body` must be a string or a JSON-serialisable object"
      );
    }
  }
  if (body !== void 0 && method === "GET") {
    throw new Error("os.http.request: `body` is not allowed for GET requests");
  }
  const timeoutMs = typeof rawArgs.timeoutMs === "number" && Number.isFinite(rawArgs.timeoutMs) ? Math.max(1, Math.trunc(rawArgs.timeoutMs)) : defaultTimeoutMs;
  const followRedirects = rawArgs.followRedirects !== false;
  return {
    url,
    urlObj,
    method,
    headers,
    body,
    timeoutMs,
    followRedirects
  };
}
function hasHeader(headers, name) {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return true;
  }
  return false;
}
function needsApproval(mode, method) {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return method !== "GET";
}
function hostAllowed(hostname, allowlist) {
  if (allowlist === null) return true;
  const lower = hostname.toLowerCase();
  for (const entry of allowlist) {
    const rule = entry.toLowerCase();
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1);
      if (lower === suffix.slice(1) || lower.endsWith(suffix)) return true;
    } else if (rule === lower) {
      return true;
    }
  }
  return false;
}
function buildApprovalPreview(args) {
  const lines = [`${args.method} ${args.url}`];
  for (const [k, v] of Object.entries(args.headers)) {
    lines.push(`${k}: ${v}`);
  }
  if (args.body !== void 0) {
    const snippet = args.body.length > 400 ? `${args.body.slice(0, 400)}\u2026 [${args.body.length} bytes]` : args.body;
    lines.push("");
    lines.push(snippet);
  }
  return lines.join("\n");
}
export {
  buildOsHttpRequestTool,
  hostAllowed,
  parseCurlOutput
};
