import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { resolveUserPath } from "../expand-home.mjs";
const DEFAULT_TIMEOUT_MS = 3e4;
const DEFAULT_HEAD_LIMIT = 200;
function parseArgs(rawArgs, workingDir) {
  const pattern = rawArgs.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("os.fs.grep: `pattern` must be a non-empty string");
  }
  const pathRaw = typeof rawArgs.path === "string" && rawArgs.path.length > 0 ? rawArgs.path : workingDir;
  const path = resolveUserPath(pathRaw, workingDir);
  const globRaw = rawArgs.glob;
  const glob = [];
  if (typeof globRaw === "string" && globRaw.length > 0) {
    glob.push(globRaw);
  } else if (Array.isArray(globRaw)) {
    for (const g of globRaw) {
      if (typeof g === "string" && g.length > 0) glob.push(g);
    }
  }
  const type = typeof rawArgs.type === "string" && rawArgs.type.length > 0 ? rawArgs.type : void 0;
  const caseInsensitive = rawArgs.caseInsensitive === true;
  const multiline = rawArgs.multiline === true;
  const literal = rawArgs.literal === true;
  const modeRaw = rawArgs.outputMode;
  const outputMode = modeRaw === "files_with_matches" || modeRaw === "count" ? modeRaw : "content";
  const contextAround = typeof rawArgs.contextAround === "number" && Number.isFinite(rawArgs.contextAround) ? Math.max(0, Math.trunc(rawArgs.contextAround)) : 0;
  const contextBefore = typeof rawArgs.contextBefore === "number" && Number.isFinite(rawArgs.contextBefore) ? Math.max(0, Math.trunc(rawArgs.contextBefore)) : contextAround;
  const contextAfter = typeof rawArgs.contextAfter === "number" && Number.isFinite(rawArgs.contextAfter) ? Math.max(0, Math.trunc(rawArgs.contextAfter)) : contextAround;
  const headLimit = typeof rawArgs.headLimit === "number" && Number.isFinite(rawArgs.headLimit) ? Math.max(1, Math.trunc(rawArgs.headLimit)) : DEFAULT_HEAD_LIMIT;
  const offset = typeof rawArgs.offset === "number" && Number.isFinite(rawArgs.offset) ? Math.max(0, Math.trunc(rawArgs.offset)) : 0;
  const showLineNumbers = rawArgs.showLineNumbers !== false;
  const timeoutMs = typeof rawArgs.timeoutMs === "number" && Number.isFinite(rawArgs.timeoutMs) ? Math.max(1, Math.trunc(rawArgs.timeoutMs)) : DEFAULT_TIMEOUT_MS;
  return {
    pattern,
    path,
    glob,
    type,
    caseInsensitive,
    multiline,
    literal,
    outputMode,
    contextBefore,
    contextAfter,
    headLimit,
    offset,
    showLineNumbers,
    timeoutMs
  };
}
async function resolveSearchTarget(path, workingDir) {
  let info;
  try {
    info = await stat(path);
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw Object.assign(new Error(`os.fs.grep: path does not exist: ${path}`), {
        code
      });
    }
    throw new Error(
      `os.fs.grep: cannot access path ${path}: ${err.message}`
    );
  }
  if (info.isDirectory()) {
    return { cwd: path, searchTarget: "." };
  }
  const parent = dirname(path);
  const cwd = parent.length > 0 ? parent : workingDir;
  return { cwd, searchTarget: basename(path) };
}
function buildRgArgs(args, searchTarget) {
  const rg = ["--json"];
  if (args.caseInsensitive) rg.push("-i");
  if (args.literal) rg.push("-F");
  if (args.multiline) {
    rg.push("-U");
    rg.push("--multiline-dotall");
  }
  if (args.contextBefore > 0) rg.push("-B", String(args.contextBefore));
  if (args.contextAfter > 0) rg.push("-A", String(args.contextAfter));
  for (const g of args.glob) {
    rg.push("--glob", g);
  }
  if (args.type) rg.push("--type", args.type);
  rg.push("--", args.pattern, searchTarget);
  return rg;
}
export {
  DEFAULT_TIMEOUT_MS,
  buildRgArgs,
  parseArgs,
  resolveSearchTarget
};
