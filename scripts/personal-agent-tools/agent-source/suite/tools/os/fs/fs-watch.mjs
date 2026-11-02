import { OS_FS_WATCH_CONTRACT } from "./fs-watch-contract.mjs";
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { watch } from "chokidar";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
const DEFAULT_TIMEOUT_MS = 5e3;
const MAX_TIMEOUT_MS = 6e4;
const MAX_EVENTS_HARD = 1e4;
const ALLOWED_EVENTS = [
  "add",
  "change",
  "unlink",
  "addDir",
  "unlinkDir"
];
const osFsWatchTool = {
  name: OS_FS_WATCH_CONTRACT.name,
  description: OS_FS_WATCH_CONTRACT.description,
  readonly: OS_FS_WATCH_CONTRACT.readonly,
  async run(rawArgs, ctx) {
    const args = await parseArgs(rawArgs, ctx.workingDir);
    const absolute = resolveUserPath(args.path, ctx.workingDir);
    const watcher = watch(absolute, {
      persistent: false,
      ignoreInitial: args.ignoreInitial,
      depth: args.recursive ? void 0 : 0,
      usePolling: false,
      awaitWriteFinish: false
    });
    const collected = [];
    let timedOut = false;
    await new Promise((resolvePromise) => {
      const deadline = setTimeout(() => {
        timedOut = true;
        resolvePromise();
      }, args.timeoutMs);
      const cleanup = () => {
        clearTimeout(deadline);
        resolvePromise();
      };
      const onAbort = () => {
        cleanup();
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      watcher.on("all", (event, changedPath) => {
        if (!args.events.has(event)) return;
        collected.push({
          kind: event,
          path: relative(absolute, changedPath) || ".",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (collected.length >= args.maxEvents) {
          ctx.signal.removeEventListener("abort", onAbort);
          cleanup();
          return;
        }
        if (args.stopAfterFirst) {
          ctx.signal.removeEventListener("abort", onAbort);
          cleanup();
        }
      });
      watcher.on("error", (err) => {
        collected.push({
          kind: "change",
          path: `(watcher error: ${err.message})`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        ctx.signal.removeEventListener("abort", onAbort);
        cleanup();
      });
    });
    await closeWatcher(watcher);
    return compressToolResult({
      tool: "os.fs.watch",
      status: "ok",
      output: formatEvents(collected, timedOut, args.timeoutMs),
      details: {
        rootAbsolute: absolute,
        timeoutMs: args.timeoutMs,
        recursive: args.recursive,
        eventsReceived: collected.length,
        timedOut,
        truncated: collected.length >= args.maxEvents,
        events: collected
      }
    });
  }
};
async function parseArgs(raw, workingDir) {
  const path = raw.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("os.fs.watch: `path` must be a non-empty string");
  }
  const absolute = resolveUserPath(path, workingDir);
  try {
    await stat(absolute);
  } catch {
    throw new Error(`os.fs.watch: path does not exist: ${absolute}`);
  }
  const timeoutMs = parseTimeout(raw.timeoutMs);
  const recursive = raw.recursive === true;
  const events = parseEvents(raw.events);
  const ignoreInitial = raw.ignoreInitial !== false;
  const maxEvents = parseMaxEvents(raw.maxEvents);
  const stopAfterFirst = raw.stopAfterFirst === true;
  return {
    path,
    timeoutMs,
    recursive,
    events,
    ignoreInitial,
    maxEvents,
    stopAfterFirst
  };
}
function parseTimeout(raw) {
  if (raw === void 0 || raw === null) return DEFAULT_TIMEOUT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error("os.fs.watch: `timeoutMs` must be a positive number");
  }
  if (raw > MAX_TIMEOUT_MS) {
    throw new Error(
      `os.fs.watch: \`timeoutMs\` exceeds the ${MAX_TIMEOUT_MS}ms cap (use a shorter timeout and re-run if needed)`
    );
  }
  return Math.floor(raw);
}
function parseEvents(raw) {
  if (raw === void 0 || raw === null) {
    return /* @__PURE__ */ new Set(["add", "change", "unlink"]);
  }
  if (!Array.isArray(raw)) {
    throw new Error("os.fs.watch: `events` must be an array of event names");
  }
  const out = /* @__PURE__ */ new Set();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new Error("os.fs.watch: `events` entries must be strings");
    }
    if (!ALLOWED_EVENTS.includes(entry)) {
      throw new Error(
        `os.fs.watch: unknown event ${JSON.stringify(entry)} (allowed: ${ALLOWED_EVENTS.join(", ")})`
      );
    }
    out.add(entry);
  }
  if (out.size === 0) {
    throw new Error("os.fs.watch: `events` cannot be empty");
  }
  return out;
}
function parseMaxEvents(raw) {
  if (raw === void 0 || raw === null) return MAX_EVENTS_HARD;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error("os.fs.watch: `maxEvents` must be a positive number");
  }
  return Math.min(MAX_EVENTS_HARD, Math.floor(raw));
}
async function closeWatcher(watcher) {
  try {
    await watcher.close();
  } catch {
  }
}
function formatEvents(events, timedOut, timeoutMs) {
  if (events.length === 0) {
    return timedOut ? `(no events within ${timeoutMs}ms)` : "(watch stopped before timeout)";
  }
  const lines = events.map(
    (e) => `${e.timestamp}  ${e.kind.padEnd(9)} ${e.path}`
  );
  if (timedOut) lines.push(`(timeout reached after ${timeoutMs}ms)`);
  return lines.join("\n");
}
export {
  osFsWatchTool
};
