import { OS_FS_GLOB_CONTRACT } from "./fs-glob-contract.mjs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  compressToolResult,
  retainToolOutput
} from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { compileGlob, matchesAny } from "./fs-glob-pattern.mjs";
import { missingRoot } from "./fs-missing-path.mjs";
import {
  createWalkBudget,
  DEFAULT_WALK_BUDGET,
  describeWalkStop
} from "./fs-walk-budget.mjs";
import { compileGlob as compileGlob2 } from "./fs-glob-pattern.mjs";
const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/Library/**",
  "**/.rustup/**",
  "**/.cargo/**",
  "**/.npm/**",
  "**/.pnpm-store/**",
  "**/.yarn/**",
  "**/.gradle/**",
  "**/.m2/**",
  "**/__pycache__/**",
  "**/site-packages/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/venv/**",
  "**/.tox/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/.terraform/**",
  "**/.idea/**",
  "**/.vscode/**",
  "**/.Trash/**",
  "**/.svn/**",
  "**/.hg/**"
];
const DEFAULT_LIMIT = 1e3;
const MAX_FILES_COLLECTED = 5e4;
function buildOsFsGlobTool(deps = {}) {
  const limits = deps.budget ?? DEFAULT_WALK_BUDGET;
  return {
    name: OS_FS_GLOB_CONTRACT.name,
    description: OS_FS_GLOB_CONTRACT.description,
    readonly: OS_FS_GLOB_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const args = parseArgs(rawArgs, ctx.workingDir);
      const missing = await missingRoot("os.fs.glob", args.cwd, ctx);
      if (missing !== null) return missing;
      const flags = args.nocase ? "i" : "";
      const matchers = args.patterns.map((p) => compileGlob(p, flags));
      const ignoreMatchers = args.ignore.map((p) => compileGlob(p, flags));
      const fileMatches = [];
      const budget = createWalkBudget(limits, {
        now: deps.now,
        signal: ctx.signal
      });
      let totalScanned = 0;
      let truncated = false;
      let stopped = null;
      async function walk(current) {
        if (fileMatches.length >= MAX_FILES_COLLECTED) {
          truncated = true;
          return;
        }
        stopped = budget.check(totalScanned);
        if (stopped !== null) return;
        let entries;
        try {
          entries = await readdir(current, {
            withFileTypes: true
          });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (fileMatches.length >= MAX_FILES_COLLECTED) {
            truncated = true;
            return;
          }
          stopped = budget.check(totalScanned);
          if (stopped !== null) return;
          const abs = join(current, entry.name);
          const rel = toPosix(relative(args.cwd, abs));
          if (rel.length === 0) continue;
          totalScanned++;
          const isDir = entry.isDirectory();
          const isFile = entry.isFile();
          const relForDir = isDir ? `${rel}/` : rel;
          if (matchesAny(ignoreMatchers, rel) || matchesAny(ignoreMatchers, relForDir)) {
            continue;
          }
          if (isFile && matchesAny(matchers, rel)) {
            try {
              const info = await stat(abs);
              fileMatches.push({ path: rel, mtimeMs: info.mtimeMs });
            } catch {
              fileMatches.push({ path: rel, mtimeMs: 0 });
            }
          }
          if (isDir) {
            await walk(abs);
          }
        }
      }
      await walk(args.cwd);
      const stop = stopped;
      if (stop !== null) truncated = true;
      if (args.sortByMtime) {
        fileMatches.sort((a, b) => b.mtimeMs - a.mtimeMs);
      } else {
        fileMatches.sort((a, b) => a.path.localeCompare(b.path));
      }
      if (fileMatches.length > args.limit) {
        truncated = true;
      }
      const finalPaths = fileMatches.slice(0, args.limit).map(
        (entry) => args.absolute ? resolve(args.cwd, entry.path) : entry.path
      );
      const summary = finalPaths.join("\n");
      const result = compressToolResult(
        {
          tool: "os.fs.glob",
          status: "ok",
          output: summary.length > 0 ? summary : "(no matches)",
          details: {
            cwd: args.cwd,
            patterns: args.patterns,
            ignore: args.ignore,
            total: fileMatches.length,
            scanned: totalScanned,
            truncated,
            files: finalPaths,
            ...stop === null ? {} : {
              stoppedBy: stop.reason,
              elapsedMs: stop.elapsedMs,
              note: describeWalkStop(stop)
            }
          }
        },
        { maxSummaryLength: 8e3, maxTailLines: 500 }
      );
      if (stop === null) return result;
      const note = `${describeWalkStop(stop)}
`;
      return retainToolOutput(
        result,
        { ...result, summary: `${note}${result.summary}`, truncated: true },
        { prefix: note, truncated: true }
      );
    }
  };
}
const osFsGlobTool = buildOsFsGlobTool();
function parseArgs(rawArgs, workingDir) {
  const patternRaw = rawArgs.pattern;
  const patterns = [];
  if (typeof patternRaw === "string") {
    if (patternRaw.length === 0) {
      throw new Error("os.fs.glob: `pattern` must be a non-empty string");
    }
    patterns.push(patternRaw);
  } else if (Array.isArray(patternRaw)) {
    for (const p of patternRaw) {
      if (typeof p !== "string" || p.length === 0) {
        throw new Error(
          "os.fs.glob: `pattern[]` entries must be non-empty strings"
        );
      }
      patterns.push(p);
    }
    if (patterns.length === 0) {
      throw new Error(
        "os.fs.glob: `pattern` array must contain at least one pattern"
      );
    }
  } else {
    throw new Error("os.fs.glob: `pattern` is required (string or string[])");
  }
  const cwdExplicit = typeof rawArgs.cwd === "string" && rawArgs.cwd.length > 0 ? rawArgs.cwd : null;
  const pathAsRoot = typeof rawArgs.path === "string" && rawArgs.path.length > 0 ? rawArgs.path : null;
  const cwdArg = cwdExplicit ?? pathAsRoot ?? workingDir;
  const cwd = resolveUserPath(cwdArg, workingDir);
  const ignore = Array.isArray(rawArgs.ignore) ? rawArgs.ignore.filter(
    (v) => typeof v === "string" && v.length > 0
  ) : DEFAULT_IGNORE;
  const absolute = rawArgs.absolute === true;
  const limit = typeof rawArgs.limit === "number" && Number.isFinite(rawArgs.limit) ? Math.max(1, Math.trunc(rawArgs.limit)) : DEFAULT_LIMIT;
  const sortByMtime = rawArgs.sortByMtime === true;
  const nocase = rawArgs.nocase === true;
  return { patterns, cwd, ignore, absolute, limit, sortByMtime, nocase };
}
function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}
export {
  buildOsFsGlobTool,
  compileGlob2 as compileGlob,
  osFsGlobTool
};
