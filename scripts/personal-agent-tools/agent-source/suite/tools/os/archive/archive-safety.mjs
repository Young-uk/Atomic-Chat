import { resolve, sep } from "node:path";
function sanitizeEntryPath(destDir, rawPath) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return { ok: false, error: { reason: "empty_path" } };
  }
  if (rawPath.includes("\0")) {
    return { ok: false, error: { reason: "null_byte" } };
  }
  if (process.platform !== "win32" && rawPath.includes("\\")) {
    return { ok: false, error: { reason: "backslash_in_path" } };
  }
  const unified = rawPath.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) {
    return { ok: false, error: { reason: "absolute_path" } };
  }
  let normalised = unified.replace(/\/+$/, "");
  if (normalised.startsWith("./")) normalised = normalised.slice(2);
  if (normalised === "." || normalised.length === 0) {
    return { ok: false, error: { reason: "empty_path" } };
  }
  const destAbs = resolve(destDir);
  const candidate = resolve(destAbs, normalised);
  if (candidate !== destAbs && !candidate.startsWith(destAbs + sep)) {
    return { ok: false, error: { reason: "traversal_escapes_dest" } };
  }
  return {
    ok: true,
    value: { normalised, absolute: candidate }
  };
}
class ExtractBudget {
  constructor(limits) {
    this.limits = limits;
  }
  entryCount = 0;
  totalBytes = 0;
  chargeEntry(size) {
    if (this.entryCount >= this.limits.maxEntries) {
      return {
        ok: false,
        reason: `max_entries_exceeded (${this.limits.maxEntries})`
      };
    }
    if (size > this.limits.maxEntryBytes) {
      return {
        ok: false,
        reason: `entry_exceeds_max_entry_bytes (${size} > ${this.limits.maxEntryBytes})`
      };
    }
    if (this.totalBytes + size > this.limits.maxTotalBytes) {
      return {
        ok: false,
        reason: `total_bytes_exceeds_cap (${this.totalBytes + size} > ${this.limits.maxTotalBytes})`
      };
    }
    this.entryCount++;
    this.totalBytes += size;
    return { ok: true };
  }
  get snapshot() {
    return { entryCount: this.entryCount, totalBytes: this.totalBytes };
  }
}
function describeSanitizationError(rawPath, err) {
  const p = JSON.stringify(rawPath);
  switch (err.reason) {
    case "absolute_path":
      return `skipped ${p}: absolute paths are not allowed`;
    case "backslash_in_path":
      return `skipped ${p}: backslashes are not allowed inside archive entries`;
    case "empty_path":
      return `skipped ${p}: entry path is empty or resolves to destDir`;
    case "traversal_escapes_dest":
      return `skipped ${p}: entry would escape the destination directory`;
    case "null_byte":
      return `skipped ${p}: path contains a NUL byte`;
  }
}
export {
  ExtractBudget,
  describeSanitizationError,
  sanitizeEntryPath
};
