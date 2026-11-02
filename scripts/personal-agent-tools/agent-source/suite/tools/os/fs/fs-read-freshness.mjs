import { open, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  retainToolOutput
} from "../../../compressor/result-compressor.mjs";
import { hashReadContent } from "./fs-read-coverage.mjs";
const STALE_READ_NOTICE = "note: this file changed since you last read it; re-read it before editing it again.";
const FRESHNESS_HASH_BYTES = 64 * 1024;
const MAX_TRACKED_FILE_VERSIONS = 256;
class FileReadVersions {
  versions = /* @__PURE__ */ new Map();
  get(canonicalPath2) {
    return this.versions.get(canonicalPath2);
  }
  record(canonicalPath2, version) {
    this.versions.delete(canonicalPath2);
    this.versions.set(canonicalPath2, version);
    while (this.versions.size > MAX_TRACKED_FILE_VERSIONS) {
      const oldest = this.versions.keys().next().value;
      if (oldest === void 0) break;
      this.versions.delete(oldest);
    }
  }
}
async function changedSinceRead(store, absolute) {
  if (store === void 0) return false;
  try {
    const canonical = await canonicalPath(absolute);
    const seen = store.get(canonical);
    if (seen === void 0) return false;
    let size;
    try {
      size = (await stat(canonical)).size;
    } catch (err) {
      return isMissing(err);
    }
    if (size !== seen.size) return true;
    const prefix = await readPrefix(canonical, Math.min(size, seen.hashedBytes));
    return hashReadContent(prefix) !== seen.contentHash;
  } catch {
    return false;
  }
}
async function recordOwnWrite(store, absolute) {
  if (store === void 0) return;
  try {
    const canonical = await canonicalPath(absolute);
    const size = (await stat(canonical)).size;
    const budget = store.get(canonical)?.hashedBytes ?? FRESHNESS_HASH_BYTES;
    const hashedBytes = Math.min(size, Math.max(budget, FRESHNESS_HASH_BYTES));
    const prefix = await readPrefix(canonical, hashedBytes);
    store.record(canonical, {
      size,
      hashedBytes,
      contentHash: hashReadContent(prefix)
    });
  } catch {
  }
}
function staleReadNoticeFor(paths) {
  if (paths.length === 1) {
    return `note: ${paths[0]} changed since you last read it; re-read it before editing it again.`;
  }
  return `note: these files changed since you last read them: ${paths.join(", ")}; re-read them before editing them again.`;
}
function withStaleReadNotice(result, changed, notice = STALE_READ_NOTICE) {
  if (!changed) return result;
  return retainToolOutput(
    result,
    {
      ...result,
      summary: result.summary.length > 0 ? `${notice}
${result.summary}` : notice,
      details: { ...result.details, changedSinceRead: true }
    },
    { prefix: `${notice}
` }
  );
}
function withStaleReadError(err, changed, tool) {
  if (!changed || !(err instanceof Error)) return err;
  if (!err.message.startsWith(`${tool}:`)) return err;
  return new Error(`${err.message}
${STALE_READ_NOTICE}`, { cause: err });
}
async function canonicalPath(absolute) {
  try {
    return await realpath(absolute);
  } catch {
    try {
      return join(await realpath(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}
async function readPrefix(path, length) {
  const buffer = Buffer.alloc(length);
  if (length === 0) return buffer;
  const handle = await open(path, "r");
  try {
    await handle.read(buffer, 0, length, 0);
  } finally {
    await handle.close();
  }
  return buffer;
}
function isMissing(err) {
  return typeof err === "object" && err !== null && err.code === "ENOENT";
}
export {
  FRESHNESS_HASH_BYTES,
  FileReadVersions,
  MAX_TRACKED_FILE_VERSIONS,
  STALE_READ_NOTICE,
  changedSinceRead,
  recordOwnWrite,
  staleReadNoticeFor,
  withStaleReadError,
  withStaleReadNotice
};
