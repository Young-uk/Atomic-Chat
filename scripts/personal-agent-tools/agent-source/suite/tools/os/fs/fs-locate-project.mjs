import { OS_FS_LOCATE_PROJECT_CONTRACT } from "./fs-locate-project-contract.mjs";
import { basename } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  canonicalizePaths,
  collectConfiguredRoots,
  collectCwdChain,
  collectSessionHistory,
  dedupeByPath,
  dropMissingDirs,
  normalizeForMatch,
  resolveDirectPath,
  sortCandidates,
  MAX_ROOT_ENTRIES,
  RECENT_SESSIONS_SCAN_LIMIT
} from "./fs-locate-project-sources.mjs";
const DEFAULT_CANDIDATE_LIMIT = 8;
const MAX_CANDIDATE_LIMIT = 25;
function buildOsFsLocateProjectTool(deps) {
  return {
    name: OS_FS_LOCATE_PROJECT_CONTRACT.name,
    description: OS_FS_LOCATE_PROJECT_CONTRACT.description,
    readonly: OS_FS_LOCATE_PROJECT_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      ctx.signal.throwIfAborted();
      const { query, rawName, limit } = parseArgs(rawArgs);
      const direct = await resolveDirectPath(rawName);
      if (direct !== null) {
        return compressToolResult(
          {
            tool: "os.fs.locate_project",
            status: "ok",
            output: `project "${rawName}" -> ${direct} (source: direct-path)`,
            details: {
              query: rawName,
              found: true,
              ambiguous: false,
              path: direct,
              source: "direct-path",
              candidates: [{ path: direct, source: "direct-path" }],
              rootsScanned: 0
            }
          },
          { maxSummaryLength: 2e3, maxTailLines: 40 }
        );
      }
      const collected = [
        ...collectCwdChain(ctx.workingDir, query),
        ...collectSessionHistory(
          deps.listRecentSessions(RECENT_SESSIONS_SCAN_LIMIT),
          query
        )
      ];
      const rootScan = await collectConfiguredRoots(
        deps.projectRoots,
        query,
        ctx.signal
      );
      collected.push(...rootScan.candidates);
      ctx.signal.throwIfAborted();
      const canonical = await canonicalizePaths(collected);
      const deduped = dedupeByPath(canonical);
      ctx.signal.throwIfAborted();
      const alive = await dropMissingDirs(deduped);
      const sorted = sortCandidates(alive);
      const displayed = sorted.slice(0, limit);
      const output = renderOutput(
        rawName,
        sorted,
        displayed,
        deps.projectRoots.length,
        rootScan
      );
      return compressToolResult(
        {
          tool: "os.fs.locate_project",
          status: "ok",
          output,
          details: buildDetails(rawName, sorted, displayed, rootScan)
        },
        // Room for the header plus a full candidate list; the tail
        // trimmer keeps LAST lines, so a short cap would eat the verdict.
        { maxSummaryLength: 2e3, maxTailLines: 40 }
      );
    }
  };
}
function parseArgs(raw) {
  const name = raw.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("os.fs.locate_project: `name` must be a non-empty string");
  }
  const rawName = name.trim();
  const lastSegment = basename(rawName.replace(/\\/g, "/"));
  const query = normalizeForMatch(
    lastSegment.length > 0 ? lastSegment : rawName
  );
  const limit = typeof raw.limit === "number" && Number.isFinite(raw.limit) ? Math.min(MAX_CANDIDATE_LIMIT, Math.max(1, Math.floor(raw.limit))) : DEFAULT_CANDIDATE_LIMIT;
  return { query, rawName, limit };
}
function splitBestTier(matches) {
  const first = matches[0];
  if (first === void 0) return { best: [], rest: [] };
  const bestTier = first.tier;
  return {
    best: matches.filter((m) => m.tier === bestTier),
    rest: matches.filter((m) => m.tier !== bestTier)
  };
}
function renderRootNotes(rootScan) {
  const notes = [];
  if (rootScan.invalidRoots.length > 0) {
    notes.push(
      `note: ${rootScan.invalidRoots.length} configured root(s) skipped (empty or not absolute): ${rootScan.invalidRoots.map((r) => JSON.stringify(r)).join(", ")}`
    );
  }
  if (rootScan.unreadableRoots.length > 0) {
    notes.push(
      `note: ${rootScan.unreadableRoots.length} configured root(s) could not be read: ${rootScan.unreadableRoots.join(", ")}`
    );
  }
  for (const root of rootScan.truncatedRoots) {
    notes.push(
      `note: root ${root} truncated at ${MAX_ROOT_ENTRIES} entries; matches beyond the cap were not scanned`
    );
  }
  return notes;
}
function renderOutput(rawName, sorted, displayed, configuredRootCount, rootScan) {
  const notes = renderRootNotes(rootScan);
  const { best } = splitBestTier(sorted);
  const hit = best.length === 1 ? best[0] : void 0;
  if (hit !== void 0) {
    const lines = [
      `project "${rawName}" -> ${hit.path} (source: ${hit.source})`
    ];
    const weaker = displayed.filter((c) => c.path !== hit.path);
    if (weaker.length > 0) {
      lines.push(
        `weaker matches (mention only if the resolved path looks wrong):`
      );
      for (const alt of weaker) lines.push(`  - ${alt.path} (${alt.source})`);
    }
    return [...lines, ...notes].join("\n");
  }
  if (best.length > 1) {
    const lines = [
      `ambiguous: ${best.length} directories match "${rawName}" equally well. Ask the user which one they mean; do not guess.`
    ];
    for (const c of displayed) lines.push(`  - ${c.path} (${c.source})`);
    if (sorted.length > displayed.length) {
      lines.push(
        `  (and ${sorted.length - displayed.length} more; raise limit to list them)`
      );
    }
    return [...lines, ...notes].join("\n");
  }
  let hint;
  if (configuredRootCount === 0) {
    hint = `No projects.roots are configured; the user can add parent directories of their projects to "projects.roots" in the agent config to widen the search.`;
  } else if (rootScan.rootsScanned === 0) {
    hint = `Checked the session working dir and recent session dirs; none of the ${configuredRootCount} configured projects.roots could be scanned (see notes).`;
  } else {
    hint = `Checked the session working dir, recent session dirs, and ${rootScan.rootsScanned} configured root(s).`;
  }
  return [
    `no project directory matching "${rawName}" was found. Ask the user for the full path. ${hint}`,
    ...notes
  ].join("\n");
}
function buildDetails(rawName, sorted, displayed, rootScan) {
  const { best } = splitBestTier(sorted);
  const top = best.length === 1 ? best[0] : void 0;
  return {
    query: rawName,
    found: top !== void 0,
    ambiguous: best.length > 1,
    ...top !== void 0 ? { path: top.path, source: top.source } : {},
    candidates: displayed.map((m) => ({ path: m.path, source: m.source })),
    rootsScanned: rootScan.rootsScanned,
    ...rootScan.invalidRoots.length > 0 ? { invalidRoots: rootScan.invalidRoots } : {},
    ...rootScan.unreadableRoots.length > 0 ? { unreadableRoots: rootScan.unreadableRoots } : {},
    ...rootScan.truncatedRoots.length > 0 ? { truncatedRoots: rootScan.truncatedRoots } : {}
  };
}
export {
  buildOsFsLocateProjectTool
};
