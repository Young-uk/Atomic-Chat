import { OS_FS_PATCH_CONTRACT } from "./fs-patch-contract.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { refuseMaskedSecretWrite } from "./fs-masked-secret-guard.mjs";
import { dirname, basename } from "node:path";
import { applyPatch, parsePatch } from "diff";
import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { checkChangedFile } from "./fs-content-check.mjs";
import { withParseWarning } from "./fs-parse-check.mjs";
import { dryRunFile } from "./fs-patch-preview.mjs";
import {
  changedSinceRead,
  recordOwnWrite,
  staleReadNoticeFor,
  withStaleReadNotice
} from "./fs-read-freshness.mjs";
import {
  guardReplacedFile,
  priorFromText,
  withReplaceNotes
} from "./fs-replace-guard.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
function buildOsFsPatchTool(options) {
  return {
    name: OS_FS_PATCH_CONTRACT.name,
    description: OS_FS_PATCH_CONTRACT.description,
    readonly: OS_FS_PATCH_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const args = await parseArgs(rawArgs, ctx.workingDir);
      const parsed = safeParsePatch(args.patch);
      const previews = await Promise.all(
        parsed.map(
          (hunkFile) => dryRunFile(
            hunkFile,
            args.rootDir,
            args.fuzzFactor,
            args.stripComponents
          )
        )
      );
      if (!args.apply) {
        return buildResult(previews, "dry-run");
      }
      const allApplicable = previews.every((p) => p.applied);
      for (let i = 0; i < parsed.length; i++) {
        const hunkFile = parsed[i];
        const outcome = previews[i];
        if (!hunkFile || !outcome?.applied) continue;
        const patched = applyPatch(
          outcome.originalContent ?? "",
          hunkFile,
          { fuzzFactor: args.fuzzFactor }
        );
        if (patched !== false) {
          refuseMaskedSecretWrite("os.fs.patch", outcome.path, outcome.originalContent ?? "", patched);
        }
      }
      const preview = formatReport(previews, "applied");
      await requireFsApproval(
        options,
        {
          kind: "write",
          paths: previews.map((p) => p.absolute),
          sessionId: ctx.sessionId,
          tool: "os.fs.patch",
          reason: `apply ${parsed.length} patch file(s) under ${args.rootDir}`,
          preview,
          affectedResources: previews.map((p) => p.absolute),
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      const changedPaths = [];
      for (const p of previews) {
        if (await changedSinceRead(ctx.fileVersions, p.absolute)) {
          changedPaths.push(p.absolute);
        }
      }
      const noteChanged = (result) => withStaleReadNotice(
        result,
        changedPaths.length > 0,
        staleReadNoticeFor(changedPaths)
      );
      if (!allApplicable) {
        return noteChanged(buildResult(previews, "apply-refused"));
      }
      const parseWarnings = [];
      const guards = [];
      for (let i = 0; i < parsed.length; i++) {
        const hunkFile = parsed[i];
        const outcome = previews[i];
        if (!hunkFile || !outcome) continue;
        const patched = applyPatch(
          outcome.originalContent ?? "",
          hunkFile,
          { fuzzFactor: args.fuzzFactor }
        );
        if (patched === false) {
          throw new Error(
            `os.fs.patch: hunk re-application failed unexpectedly for ${outcome.path}`
          );
        }
        await writeFile(outcome.absolute, patched, "utf8");
        await recordOwnWrite(ctx.fileVersions, outcome.absolute);
        guards.push(await guardAfterPatch(options, ctx, outcome, patched));
        const warning = parseWarningAfterPatch(
          outcome,
          patched,
          ctx.workingDir
        );
        if (warning !== null) parseWarnings.push(warning);
      }
      return noteChanged(withReplaceNotes(
        withParseWarning(
          buildResult(previews, "applied"),
          parseWarnings.length > 0 ? parseWarnings.join("\n") : null
        ),
        guards
      ));
    }
  };
}
async function guardAfterPatch(options, ctx, outcome, patched) {
  if (!outcome.existed) {
    try {
      await options.restore?.recordCreated(ctx.sessionId, outcome.absolute);
    } catch {
    }
    return { note: null };
  }
  return guardReplacedFile({
    store: options.restore,
    sessionId: ctx.sessionId,
    workingDir: ctx.workingDir,
    absolute: outcome.absolute,
    display: outcome.absolute,
    tool: "os.fs.patch",
    change: "shrink",
    prior: priorFromText(outcome.originalContent ?? ""),
    after: patched
  });
}
function parseWarningAfterPatch(outcome, patched, workingDir) {
  if (patched.length === 0) return null;
  const original = outcome.originalContent ?? "";
  return checkChangedFile({
    absolute: outcome.absolute,
    workingDir,
    change: "patch",
    after: patched,
    ...original.length > 0 ? { before: original } : {}
  });
}
async function parseArgs(rawArgs, workingDir) {
  const patch = rawArgs.patch;
  const patchPath = rawArgs.patchPath;
  let patchString;
  if (typeof patch === "string" && patch.length > 0) {
    patchString = patch;
  } else if (typeof patchPath === "string" && patchPath.length > 0) {
    const abs = resolveUserPath(patchPath, workingDir);
    patchString = await readFile(abs, "utf8");
  } else {
    throw new Error(
      "os.fs.patch: provide either `patch` (string) or `patchPath` (file)"
    );
  }
  const apply = rawArgs.apply === true;
  const rootDirRaw = rawArgs.rootDir;
  const rootDir = typeof rootDirRaw === "string" && rootDirRaw.length > 0 ? resolveUserPath(rootDirRaw, workingDir) : workingDir;
  const fuzzFactor = parseNonNegativeInt(rawArgs.fuzzFactor, 0, "fuzzFactor");
  const stripComponents = parseNonNegativeInt(
    rawArgs.stripComponents,
    1,
    "stripComponents"
  );
  return { patch: patchString, apply, rootDir, fuzzFactor, stripComponents };
}
function parseNonNegativeInt(raw, fallback, field) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`os.fs.patch: \`${field}\` must be a non-negative number`);
  }
  return Math.floor(raw);
}
function safeParsePatch(source) {
  try {
    return parsePatch(source);
  } catch (err) {
    throw new Error(
      `os.fs.patch: failed to parse patch \u2014 ${err.message}`
    );
  }
}
function buildResult(previews, mode) {
  const output = formatReport(previews, mode);
  const anyFailed = previews.some((p) => !p.applied);
  return compressToolResult(
    {
      tool: "os.fs.patch",
      status: mode === "apply-refused" ? "error" : "ok",
      output,
      details: {
        mode,
        files: previews.map((p) => ({
          path: p.path,
          absolute: p.absolute,
          applied: p.applied,
          reason: p.reason,
          addedLines: p.addedLines,
          removedLines: p.removedLines
        })),
        anyFailed
      }
    },
    { maxSummaryLength: 32 * 1024, maxTailLines: 1e3 }
  );
}
function formatReport(previews, mode) {
  const header = mode === "dry-run" ? "patch dry-run:" : mode === "applied" ? "patch applied:" : "patch apply REFUSED \u2014 some hunks could not land:";
  const lines = [header];
  for (const p of previews) {
    const mark = p.applied ? "\u2713" : "\u2717";
    const bits = [`${mark} ${p.path}`, `+${p.addedLines}/-${p.removedLines}`];
    if (p.reason) bits.push(p.reason);
    lines.push(`  ${bits.join("  ")}`);
  }
  return lines.join("\n");
}
const _internal = { dirname, basename };
export {
  _internal,
  buildOsFsPatchTool
};
