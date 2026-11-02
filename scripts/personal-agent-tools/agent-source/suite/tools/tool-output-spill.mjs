import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  retainToolOutput
} from "../compressor/result-compressor.mjs";
const SPILL_TOOLS = /* @__PURE__ */ new Set([
  "os.shell.run",
  "skill.run_script",
  "os.git.diff",
  "os.git.log",
  "os.git.show",
  "os.git.blame",
  "os.git.status",
  "os.fs.grep",
  "os.fs.glob",
  "os.fs.list",
  "os.fs.diff",
  "os.fs.archive.list",
  "os.proc.list"
]);
const SPILL_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SPILL_MAX_SESSION_BYTES = 50 * 1024 * 1024;
const STALE_SPILL_MS = 7 * 24 * 60 * 60 * 1e3;
const FULL_OUTPUT_PATH_DETAIL = "fullOutputPath";
const BASE_NAME = "atomic-agent-tool-outputs";
function toolOutputBaseDir() {
  return join(tmpdir(), BASE_NAME);
}
function toolOutputDir(sessionId, baseDir = toolOutputBaseDir()) {
  return join(baseDir, safeSegment(sessionId));
}
class ToolOutputSpill {
  baseDir;
  maxFileBytes;
  maxSessionBytes;
  used = /* @__PURE__ */ new Map();
  counters = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.baseDir = options.baseDir;
    this.maxFileBytes = options.maxFileBytes ?? SPILL_MAX_FILE_BYTES;
    this.maxSessionBytes = options.maxSessionBytes ?? SPILL_MAX_SESSION_BYTES;
  }
  /** The folder `sessionId` spills into. */
  dirFor(sessionId) {
    return toolOutputDir(sessionId, this.baseDir ?? toolOutputBaseDir());
  }
  /**
   * `result` with its full output saved and the path leading the
   * summary, or `result` itself when it was not clipped, the tool is not
   * on the allowlist, the session's budget is spent or the write failed.
   */
  async spill(tool, sessionId, result) {
    const full = result.fullOutput;
    if (!SPILL_TOOLS.has(tool) || !result.truncated || full === void 0) {
      return result;
    }
    if (full.length <= result.summary.length) return result;
    const bytes = Buffer.byteLength(full, "utf8");
    const kept = Math.min(bytes, this.maxFileBytes);
    const used = this.used.get(sessionId) ?? 0;
    if (used + kept > this.maxSessionBytes) return result;
    try {
      const dir = this.ensureDir(sessionId);
      const index = (this.counters.get(sessionId) ?? 0) + 1;
      this.counters.set(sessionId, index);
      const path = join(
        dir,
        `${String(index).padStart(4, "0")}-${randomBytes(3).toString("hex")}-${fileStem(tool)}.txt`
      );
      const body = bytes > this.maxFileBytes ? `${Buffer.from(full, "utf8").subarray(0, this.maxFileBytes).toString("utf8")}
[output cut at ${this.maxFileBytes} bytes of ${bytes}]
` : full;
      await writeFile(path, body, { encoding: "utf8", mode: 384, flag: "wx" });
      this.used.set(sessionId, used + kept);
      const note = spillNote(path, countLines(full), bytes > this.maxFileBytes);
      return retainToolOutput(
        result,
        {
          ...result,
          summary: `${note}
${result.summary}`,
          details: { ...result.details, [FULL_OUTPUT_PATH_DETAIL]: path }
        },
        { prefix: `${note}
` }
      );
    } catch {
      return result;
    }
  }
  /** Remove one session's folder. Best effort. */
  removeSession(sessionId) {
    this.used.delete(sessionId);
    this.counters.delete(sessionId);
    const base = this.baseDir ?? toolOutputBaseDir();
    if (!isOwnPlainDir(base)) return;
    removeInside(base, this.dirFor(sessionId));
  }
  /** Remove session folders not touched for `maxAgeMs`. Best effort; returns how many went. */
  sweepStale(maxAgeMs = STALE_SPILL_MS, now = Date.now()) {
    const base = this.baseDir ?? toolOutputBaseDir();
    let removed = 0;
    if (!isOwnPlainDir(base)) return 0;
    let names;
    try {
      names = readdirSync(base);
    } catch {
      return 0;
    }
    for (const name of names) {
      const dir = join(base, name);
      try {
        if (now - statSync(dir).mtimeMs < maxAgeMs) continue;
      } catch {
        continue;
      }
      if (removeInside(base, dir)) removed += 1;
    }
    return removed;
  }
  /**
   * Create the session folder owner-only, and refuse one that is a
   * symlink or belongs to someone else: on a shared `/tmp` another user
   * could have made it first.
   */
  ensureDir(sessionId) {
    const base = this.baseDir ?? toolOutputBaseDir();
    const dir = this.dirFor(sessionId);
    mkdirSync(base, { recursive: true, mode: 448 });
    mkdirSync(dir, { recursive: true, mode: 448 });
    for (const path of [base, dir]) {
      if (!isOwnPlainDir(path)) {
        throw new Error("tool output folder is a link or belongs to another user");
      }
    }
    return dir;
  }
}
function isOwnPlainDir(path) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const uid = process.getuid?.();
    return uid === void 0 || info.uid === uid;
  } catch {
    return false;
  }
}
function spillNote(path, lines, cut) {
  const size = `${lines} line${lines === 1 ? "" : "s"}`;
  return cut ? `[output clipped; the first part of it (${size} in all) is saved in ${path}. Read the part you need with os.fs.read and offset/limit instead of running this again.]` : `[output clipped; all ${size} are saved in ${path}. Read the part you need with os.fs.read and offset/limit instead of running this again.]`;
}
function countLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}
function fileStem(tool) {
  return tool.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40);
}
function safeSegment(value) {
  const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "_";
}
function removeInside(base, dir) {
  if (!resolve(dir).startsWith(`${resolve(base)}${sep}`)) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
export {
  FULL_OUTPUT_PATH_DETAIL,
  SPILL_MAX_FILE_BYTES,
  SPILL_MAX_SESSION_BYTES,
  SPILL_TOOLS,
  STALE_SPILL_MS,
  ToolOutputSpill,
  spillNote,
  toolOutputBaseDir,
  toolOutputDir
};
