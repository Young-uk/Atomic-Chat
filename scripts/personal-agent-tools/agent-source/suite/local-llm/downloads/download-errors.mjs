class DownloadHttpError extends Error {
  constructor(status, statusText) {
    super(`Download failed: HTTP ${status} ${statusText}`);
    this.status = status;
    this.name = "DownloadHttpError";
  }
}
class StalledError extends Error {
  constructor(ms) {
    super(`Download stalled: no data for ${Math.round(ms / 1e3)}s`);
    this.name = "StalledError";
  }
}
class RangeRejectedError extends Error {
  constructor(detail) {
    super(`Download resume rejected: ${detail}`);
    this.name = "RangeRejectedError";
  }
}
class InterceptedError extends Error {
  constructor(detail) {
    super(`Download intercepted: ${detail}`);
    this.name = "InterceptedError";
  }
}
class RangesUnsupportedError extends Error {
  constructor() {
    super(
      "Download server ignored a Range request; continuing with one connection"
    );
    this.name = "RangesUnsupportedError";
  }
}
class DownloadGaveUpError extends Error {
  constructor(reason, detail, cause) {
    super(`Download gave up: ${detail} (last error: ${cause.message})`);
    this.reason = reason;
    this.cause = cause;
    this.name = "DownloadGaveUpError";
  }
}
const TRANSPORT_ERRNO = /* @__PURE__ */ new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "EADDRNOTAVAIL"
]);
const LOCAL_ERRNO = /* @__PURE__ */ new Set([
  "ENOSPC",
  "EACCES",
  "EPERM",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "EISDIR",
  "ENOTDIR",
  "EIO",
  "EDQUOT",
  "EBADF"
]);
const FATAL_CODE_PREFIXES = [
  "ERR_INVALID_",
  "ERR_TLS_",
  "ERR_SSL_",
  "ERR_OSSL_"
];
const FATAL_CODES = /* @__PURE__ */ new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "HOSTNAME_MISMATCH"
]);
function isFatalCode(code) {
  return FATAL_CODES.has(code) || FATAL_CODE_PREFIXES.some((p) => code.startsWith(p));
}
function errnoOf(err) {
  let cur = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth += 1) {
    const code = cur.code;
    if (typeof code === "string") return code;
    cur = cur.cause;
  }
  return null;
}
function createAbortError() {
  const err = new Error("Download aborted");
  err.name = "AbortError";
  return err;
}
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}
function isAbortError(err) {
  return err instanceof Error && err.name === "AbortError";
}
function classifyDownloadError(err) {
  if (isAbortError(err)) return "aborted";
  if (err instanceof DownloadGaveUpError) return "fatal";
  if (err instanceof StalledError || err instanceof InterceptedError || // Range negotiation failed, not the file: the caller either drops
  // the partial and starts over or falls back to one stream. Both
  // are worth another attempt, and both survive a relaunch.
  err instanceof RangeRejectedError || err instanceof RangesUnsupportedError) {
    return "transport";
  }
  if (err instanceof DownloadHttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500 ? "server" : "fatal";
  }
  const code = errnoOf(err);
  if (code && (LOCAL_ERRNO.has(code) || isFatalCode(code))) return "fatal";
  if (code && (TRANSPORT_ERRNO.has(code) || code.startsWith("UND_ERR_")))
    return "transport";
  if (err instanceof TypeError && err.cause === void 0 && !/fetch failed|terminated/i.test(err.message)) {
    return "fatal";
  }
  return "transport";
}
function isRetryableDownloadError(err) {
  const kind = classifyDownloadError(err);
  return kind === "transport" || kind === "server";
}
function isResumableDownloadError(err) {
  if (err instanceof DownloadGaveUpError) return true;
  return classifyDownloadError(err) === "transport";
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function parseContentRange(header) {
  if (!header) return null;
  const trimmed = header.trim();
  const full = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(trimmed);
  if (full) {
    return {
      start: Number(full[1]),
      end: Number(full[2]) + 1,
      total: full[3] === "*" ? 0 : Number(full[3])
    };
  }
  const unsatisfied = /^bytes \*\/(\d+)$/.exec(trimmed);
  if (unsatisfied) {
    return { start: -1, end: -1, total: Number(unsatisfied[1]) };
  }
  return null;
}
function sameValidator(stored, res) {
  const etag = res.headers.get("etag");
  if (stored.etag) return etag === stored.etag;
  const lastModified = res.headers.get("last-modified");
  return stored.lastModified !== null && lastModified === stored.lastModified;
}
function validatorsMatch(stored, res) {
  const etag = res.headers.get("etag");
  if (stored.etag && etag && stored.etag !== etag) return false;
  const lastModified = res.headers.get("last-modified");
  if (!stored.etag && stored.lastModified && lastModified && stored.lastModified !== lastModified) {
    return false;
  }
  return true;
}
export {
  DownloadGaveUpError,
  DownloadHttpError,
  InterceptedError,
  RangeRejectedError,
  RangesUnsupportedError,
  StalledError,
  classifyDownloadError,
  createAbortError,
  isAbortError,
  isResumableDownloadError,
  isRetryableDownloadError,
  parseContentRange,
  sameValidator,
  sleep,
  throwIfAborted,
  validatorsMatch
};
