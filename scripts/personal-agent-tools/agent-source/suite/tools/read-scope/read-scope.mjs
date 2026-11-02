import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { isInside } from "../../approval/fanout-scope.mjs";
import {
  compressToolResult
} from "../../compressor/result-compressor.mjs";
import { isFusionWorkerSessionId } from "../../session/fusion-worker-session.mjs";
import { resolveUserPath } from "../os/expand-home.mjs";
import { toolOutputDir } from "../tool-output-spill.mjs";
import { READ_TOOL_TARGETS, URL_LIKE } from "./read-scope-targets.mjs";
const READ_REFUSAL_REASON = "read-outside-scope";
const WORKER_READ_REFUSAL_REASON = "worker-read-outside-scope";
function canonical(path) {
  const rest = [];
  let current = path;
  for (; ; ) {
    try {
      return resolve(realpathSync.native(current), ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.push(basename(current));
      current = parent;
    }
  }
}
function isOutsideReadRoots(target, roots) {
  if (roots.some((root) => isInside(resolve(root), target))) return false;
  const real = canonical(target);
  return !roots.some((root) => isInside(canonical(resolve(root)), real));
}
function isOwnToolOutput(target, dir) {
  return isInside(resolve(dir), target) && isInside(canonical(resolve(dir)), canonical(target));
}
function isUnderAny(path, prefixes) {
  if (prefixes.some((prefix) => isInside(prefix, path))) return true;
  const real = canonical(path);
  return prefixes.some((prefix) => isInside(canonical(prefix), real));
}
function scratchDirs() {
  return process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp", "/var/tmp"];
}
function isScratchPath(path) {
  return isUnderAny(path, scratchDirs());
}
function sessionReadRoots(ctx) {
  return [ctx.workingDir, ...ctx.readRoots ?? []];
}
const uncut = (output) => ({
  maxSummaryLength: Math.max(1e3, output.length + 50)
});
function workerReadRefusal(tool, path, ctx, grantedDirs) {
  const alsoScope = grantedDirs.length > 0 ? ` or the directories this fan-out may write in (${grantedDirs.join(", ")})` : "";
  const output = `${tool} refused: ${path} is outside this worker's working directory (${ctx.workingDir})${alsoScope}, and a worker reads only inside those. Do not search elsewhere for context: use your task, its FILES and the original request, and name anything missing in your reply.`;
  return compressToolResult(
    {
      tool,
      status: "error",
      output,
      details: {
        reason: WORKER_READ_REFUSAL_REASON,
        path,
        allowedRoots: [ctx.workingDir, ...grantedDirs]
      }
    },
    uncut(output)
  );
}
function sessionReadDeclined(tool, path, roots, declined) {
  return compressToolResult(
    {
      tool,
      status: "error",
      output: declined,
      details: {
        reason: READ_REFUSAL_REASON,
        path,
        allowedRoots: [...roots],
        deniedByUser: true
      }
    },
    uncut(declined)
  );
}
function sessionReadRefusal(tool, path, ctx, roots) {
  const output = `${tool} refused: reads are confined to the working directory (${ctx.workingDir}) and the paths the user named; ask the user to name ${path} or to set agent.readScope: unrestricted`;
  return compressToolResult(
    {
      tool,
      status: "error",
      output,
      details: { reason: READ_REFUSAL_REASON, path, allowedRoots: [...roots] }
    },
    uncut(output)
  );
}
function firstTargetOutside(tool, args, ctx, roots, scratchInScope) {
  const targetsOf = READ_TOOL_TARGETS.get(tool);
  if (targetsOf === void 0) return null;
  const ownOutputs = toolOutputDir(ctx.sessionId);
  for (const raw of targetsOf(args)) {
    if (URL_LIKE.test(raw)) continue;
    let absolute;
    try {
      absolute = resolveUserPath(raw, ctx.workingDir);
    } catch {
      continue;
    }
    if (scratchInScope && isScratchPath(absolute)) continue;
    if (isOwnToolOutput(absolute, ownOutputs)) continue;
    if (isOutsideReadRoots(absolute, roots)) return absolute;
  }
  return null;
}
function checkWorkerRead(tool, args, ctx, grantedDirs) {
  if (!isFusionWorkerSessionId(ctx.sessionId)) return null;
  const outside = firstTargetOutside(
    tool,
    args,
    ctx,
    [ctx.workingDir, ...grantedDirs],
    false
  );
  return outside === null ? null : workerReadRefusal(tool, outside, ctx, grantedDirs);
}
function findSessionReadOutside(tool, args, ctx, roots) {
  if (isFusionWorkerSessionId(ctx.sessionId)) return null;
  return firstTargetOutside(tool, args, ctx, roots, true);
}
export {
  READ_REFUSAL_REASON,
  WORKER_READ_REFUSAL_REASON,
  canonical,
  checkWorkerRead,
  findSessionReadOutside,
  isOutsideReadRoots,
  isScratchPath,
  isUnderAny,
  scratchDirs,
  sessionReadDeclined,
  sessionReadRefusal,
  sessionReadRoots,
  workerReadRefusal
};
