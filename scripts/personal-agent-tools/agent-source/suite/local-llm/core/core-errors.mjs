import { classifyDownloadError, DownloadGaveUpError } from "../downloads/download-errors.mjs";
import { isWindowsArm64, WINDOWS_ARM64_NO_BACKEND_MESSAGE } from "../backend/platform-assets.mjs";
const CORE_RETRY_HINT = "Retry with: atomic-agent models update (TUI: press R in Models).";
const NO_CORE_FOR_MACHINE = /* @__PURE__ */ new Set(["no_backend", "unsupported"]);
function noCoreForMachineSentence(platform = process.platform, arch = process.arch) {
  return isWindowsArm64(platform, arch) ? WINDOWS_ARM64_NO_BACKEND_MESSAGE : "Atomic Chat cannot run local models on this computer.";
}
const STAGE_TEXT = {
  download: "The Atomic Chat engine could not be downloaded",
  verify: "The downloaded Atomic Chat engine did not pass verification",
  backend: "Atomic Chat could not install its inference backend",
  start: "The Atomic Chat engine could not start"
};
const NOT_RETRYABLE = /* @__PURE__ */ new Set(["unsupported", "version", "no_backend", "disk"]);
class CoreUnavailableError extends Error {
  name = "CoreUnavailableError";
  stage;
  reasonCode;
  reason;
  retryable;
  constructor(opts) {
    const detail = opts.detail?.trim().replace(/\.$/, "");
    const reason = detail ? `${STAGE_TEXT[opts.stage]}: ${detail}.` : `${STAGE_TEXT[opts.stage]}.`;
    const next = NO_CORE_FOR_MACHINE.has(opts.reasonCode) ? noCoreForMachineSentence() : CORE_RETRY_HINT;
    super(`${reason} ${next}`, opts.cause === void 0 ? void 0 : { cause: opts.cause });
    this.stage = opts.stage;
    this.reasonCode = opts.reasonCode;
    this.reason = reason;
    this.retryable = opts.retryable ?? !NOT_RETRYABLE.has(opts.reasonCode);
  }
  get info() {
    return { stage: this.stage, reasonCode: this.reasonCode, retryable: this.retryable, reason: this.reason };
  }
}
function isCoreUnavailableError(err) {
  return err instanceof CoreUnavailableError;
}
function shouldFallBackFromCore(failure) {
  return Boolean(failure && !failure.retryable && NO_CORE_FOR_MACHINE.has(failure.reasonCode));
}
const CORE_FALLBACK_LINE = "Atomic Chat has no engine build for this computer, so local models now use the llama.cpp engine (llama-server). Switch back with: atomic-agent models engine atomic-core";
const DISK_ERRNO = /* @__PURE__ */ new Set(["ENOSPC", "EDQUOT", "EROFS"]);
function errnoOf(err) {
  let cur = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth += 1) {
    const code = cur.code;
    if (typeof code === "string") return code;
    cur = cur.cause;
  }
  return null;
}
function classifyCoreFailure(err) {
  const code = errnoOf(err);
  if (code && DISK_ERRNO.has(code)) return "disk";
  if (code === "ENOENT" || code === "EACCES" || code === "ENOEXEC") return "spawn";
  const status = err?.status;
  if (typeof status === "number") return status >= 500 || status === 408 || status === 429 ? "server" : "unknown";
  if (err instanceof Error && (err.name === "TimeoutError" || err instanceof TypeError && /fetch failed/.test(err.message))) return "network";
  if (err instanceof DownloadGaveUpError) return "network";
  const kind = classifyDownloadError(err);
  if (kind === "server") return "server";
  if (kind === "transport" && code) return "network";
  return "unknown";
}
function isCoreCancellation(err, signal) {
  return Boolean(signal?.aborted) || err instanceof Error && err.name === "AbortError";
}
function toCoreUnavailable(err, stage, signal) {
  if (isCoreCancellation(err, signal) || !(err instanceof Error)) return err;
  if (err instanceof CoreUnavailableError) return err;
  return new CoreUnavailableError({ stage, reasonCode: classifyCoreFailure(err), detail: err.message, cause: err });
}
export {
  CORE_FALLBACK_LINE,
  CORE_RETRY_HINT,
  CoreUnavailableError,
  classifyCoreFailure,
  isCoreCancellation,
  isCoreUnavailableError,
  noCoreForMachineSentence,
  shouldFallBackFromCore,
  toCoreUnavailable
};
