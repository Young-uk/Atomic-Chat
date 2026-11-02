import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { OS_FS_MOVE_CONTRACT, parseMoveArgs } from "./fs-move-contract.mjs";
import {
  NODE_MOVE_FS,
  isStrictlyInside,
  planMoves,
  sameEntry
} from "./fs-move-plan.mjs";
import { formatBytes, readPriorFile } from "./fs-replace-guard.mjs";
import { RESTORE_MAX_BYTES } from "./fs-restore-store.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
import { describeMoves, previewMoves } from "./fs-move-text.mjs";
import { okResult, partialResult } from "./fs-move-result.mjs";
const NAME = OS_FS_MOVE_CONTRACT.name;
function buildOsFsMoveTool(options, deps = {}) {
  const fs = deps.fs ?? NODE_MOVE_FS;
  return {
    name: NAME,
    description: OS_FS_MOVE_CONTRACT.description,
    readonly: OS_FS_MOVE_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const { moves: items, overwrite } = parseMoveArgs(rawArgs);
      const plan = await planMoves(items, {
        workingDir: ctx.workingDir,
        overwrite,
        fs
      });
      const sources = plan.map((m) => m.source);
      const dests = plan.map((m) => m.dest);
      const declared = options.declaredInputs?.inputsOf(ctx.sessionId) ?? [];
      const touched = declared.find(
        (input) => plan.some(
          (m) => m.source === input || m.dest === input || m.folder && isStrictlyInside(m.source, input)
        )
      );
      if (touched !== void 0) {
        throw new Error(
          `os.fs.move: \`${touched}\` is an input of this task; it is not moved or replaced \u2014 copy what you need with os.fs.write instead`
        );
      }
      await requireFsApproval(
        options,
        {
          // Both ends change: the source's folder loses an entry and the
          // destination gains one, so both are classified (weakest wins,
          // and the agent's own config on either end is `trust_config`).
          kind: "write",
          // Plus any trust-config file inside a moved folder: moving the
          // folder that holds `config.json` is a change to it, and the
          // classifier only matches the file's own path.
          paths: [
            ...sources,
            ...dests,
            ...await trustPathsInside(plan, options.trustConfigPaths ?? [], fs)
          ],
          sessionId: ctx.sessionId,
          tool: NAME,
          reason: describeMoves(plan),
          preview: previewMoves(plan),
          affectedResources: [...sources, ...dests],
          // A no to this move is a no to removing these paths another way.
          targetPaths: [
            ...sources,
            ...plan.filter((m) => m.replaces).map((m) => m.dest)
          ],
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      const done = [];
      const notes = [];
      for (const move of plan) {
        if (ctx.signal.aborted) {
          return partialResult(done, move, plan.length, "the turn was stopped", notes);
        }
        try {
          const note = move.replaces ? await saveReplaced(move, options, ctx) : null;
          done.push(await moveOne(move, fs));
          if (note !== null) notes.push(note);
        } catch (err) {
          return partialResult(done, move, plan.length, err.message, notes);
        }
      }
      return okResult(done, notes);
    }
  };
}
async function moveOne(move, fs) {
  await fs.mkdir(dirname(move.dest), { recursive: true });
  await refuseIfOccupied(move, fs);
  try {
    await fs.rename(move.source, move.dest);
    return { move, method: "rename" };
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  const temp = join(
    dirname(move.dest),
    `.${basename(move.dest)}.moving-${randomBytes(4).toString("hex")}`
  );
  try {
    await fs.cp(move.source, temp, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true
    });
    await refuseIfOccupied(move, fs);
    await fs.rename(temp, move.dest);
  } catch (err) {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {
    });
    throw err;
  }
  try {
    await fs.rm(move.source, { recursive: true });
  } catch (err) {
    return {
      move,
      method: "copy",
      sourceKept: `copied \`${move.from}\` to \`${move.dest}\`, but the original could not be removed (${err.message})`
    };
  }
  return { move, method: "copy" };
}
async function refuseIfOccupied(move, fs) {
  if (move.replaces) return;
  try {
    await fs.lstat(move.dest);
  } catch {
    return;
  }
  if (await sameEntry(fs, move.source, move.dest)) return;
  throw new Error(`\`${move.dest}\` appeared after the check; nothing was replaced`);
}
async function trustPathsInside(plan, trustPaths, fs) {
  if (trustPaths.length === 0) return [];
  const real = async (path) => {
    try {
      return await fs.realpath(path);
    } catch {
      return path;
    }
  };
  const roots = [];
  for (const move of plan) {
    if (!move.folder) continue;
    roots.push(move.source, move.dest, await real(move.source));
  }
  const hits = [];
  for (const trust of trustPaths) {
    const canonical = await real(trust);
    if (roots.some((root) => isStrictlyInside(root, trust) || isStrictlyInside(root, canonical))) {
      hits.push(trust);
    }
  }
  return hits;
}
async function saveReplaced(move, options, ctx) {
  const prior = await readPriorFile(move.dest);
  const head = `replaced the existing file \`${move.dest}\``;
  if (options.restore === void 0 || prior === null) {
    return `\u26A0 ${head}; no copy of its previous content was kept`;
  }
  if (prior.content === null) {
    return `\u26A0 ${head}; its previous content was too large to save (over ${formatBytes(RESTORE_MAX_BYTES)})`;
  }
  await options.restore.saveCopy(ctx.workingDir, move.dest, prior.content, {
    tool: NAME,
    lines: prior.lines ?? 0,
    sessionId: ctx.sessionId
  });
  return `${head}; its previous content is saved \u2014 \`os.fs.restore ${JSON.stringify({ path: move.dest })}\` brings it back`;
}
export {
  buildOsFsMoveTool
};
