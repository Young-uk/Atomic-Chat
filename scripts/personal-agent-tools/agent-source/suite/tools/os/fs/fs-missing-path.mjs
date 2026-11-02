import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import { isFusionWorkerSessionId } from "../../../session/fusion-worker-session.mjs";
import {
  isScratchPath,
  isUnderAny,
  sessionReadRoots
} from "../../read-scope/index.mjs";
import {
  candidateRoots
} from "./path-candidate-roots.mjs";
import {
  candidateName,
  findPathCandidates
} from "./path-candidates.mjs";
const MAX_SHOWN = 5;
const MISSING_CODES = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);
function isMissingPathError(err) {
  return MISSING_CODES.has(errorCode(err) ?? "");
}
function errorCode(err) {
  if (typeof err !== "object" || err === null) return void 0;
  const code = err.code;
  return typeof code === "string" ? code : void 0;
}
async function orMissing(tool, absolute, ctx, op) {
  try {
    return await op();
  } catch (err) {
    if (!isMissingPathError(err)) throw err;
    return { missing: await missingPathResult(tool, absolute, ctx, errorCode(err)) };
  }
}
async function missingRoot(tool, absolute, ctx) {
  const code = await stat(absolute).then(
    () => void 0,
    (err) => isMissingPathError(err) ? errorCode(err) : void 0
  );
  return code === void 0 ? null : missingPathResult(tool, absolute, ctx, code);
}
async function missingPathResult(tool, absolute, ctx, code = "ENOENT", plan) {
  const worker = isFusionWorkerSessionId(ctx.sessionId);
  const isInScope = (path) => inScope(path, ctx);
  const search = worker ? { found: [], complete: true } : await searchNear(absolute, plan ?? await defaultPlan(absolute, ctx), isInScope);
  const output = missingPathMessage(tool, absolute, search, isInScope, {
    worker,
    code
  });
  return compressToolResult(
    {
      tool,
      status: "error",
      output,
      details: {
        path: absolute,
        errorCode: code,
        candidates: search.found.map((c) => c.path)
      }
    },
    { maxSummaryLength: Math.max(1e3, output.length + 50), maxTailLines: 20 }
  );
}
function searchNear(absolute, plan, isInScope) {
  return findPathCandidates(absolute, plan.roots, void 0, {
    blocked: plan.blocked,
    // Dot-names outside the scope (.ssh, an .env elsewhere) are never offered.
    accept: (c) => isInScope(c.path) || !basename(c.path).startsWith(".")
  });
}
function defaultPlan(absolute, ctx) {
  return candidateRoots({
    missing: absolute,
    workingDir: ctx.workingDir,
    readRoots: ctx.readRoots,
    home: homedir(),
    oneDrive: process.env.OneDrive
  });
}
function inScope(path, ctx) {
  return isUnderAny(path, sessionReadRoots(ctx)) || isScratchPath(path);
}
const REASONS = {
  ENOENT: "ENOENT: no such file or directory",
  ENOTDIR: "ENOTDIR: a part of the path is a file, not a folder"
};
function missingPathMessage(tool, absolute, search, isInScope, options = {}) {
  const code = options.code ?? "ENOENT";
  const head = `${tool}: ${absolute} does not exist (${REASONS[code] ?? code}).`;
  if (options.worker === true) {
    return `${head} Do not search elsewhere; name it as missing in your reply.`;
  }
  const name = candidateName(absolute) ?? absolute;
  const { found } = search;
  if (found.length === 0) {
    const searched = search.complete ? `Nothing named "${name}" was found nearby.` : `A quick search found nothing named "${name}".`;
    return `${head} ${searched} Do not retry the same path.`;
  }
  const shown = found.slice(0, MAX_SHOWN);
  const list = shown.map((c) => `- ${describe(c, isInScope)}`);
  if (found.length > MAX_SHOWN) list.push("- \u2026 and more");
  const folderNote = tool === "os.fs.read" && shown.some((c) => c.kind === "folder") ? " A folder is listed with os.fs.list, not read." : "";
  return `${head} Something named "${name}" exists elsewhere. If you meant one of these, use it (ask the user if several fit); if you were only checking whether it exists, it does not.${folderNote}
` + list.join("\n");
}
function describe(candidate, isInScope) {
  const notes = [];
  if (candidate.kind !== "other") notes.push(candidate.kind);
  if (!isInScope(candidate.path)) {
    notes.push(
      "outside the working folder; reading it will ask the user for permission"
    );
  }
  return notes.length === 0 ? candidate.path : `${candidate.path} (${notes.join(", ")})`;
}
export {
  isMissingPathError,
  missingPathMessage,
  missingPathResult,
  missingRoot,
  orMissing
};
