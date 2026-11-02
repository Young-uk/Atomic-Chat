import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { applyPatch } from "diff";
async function dryRunFile(hunkFile, rootDir, fuzzFactor, stripComponents) {
  const targetRel = pickTargetPath(hunkFile, stripComponents);
  const abs = isAbsolute(targetRel) ? targetRel : resolve(rootDir, targetRel);
  const counts = countPatchLines(hunkFile);
  let originalContent = "";
  let existed = false;
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      return {
        path: targetRel,
        absolute: abs,
        applied: false,
        reason: "target is not a regular file",
        addedLines: counts.added,
        removedLines: counts.removed,
        existed: true
      };
    }
    originalContent = await readFile(abs, "utf8");
    existed = true;
  } catch (err) {
    const isMissing = err.code === "ENOENT";
    if (!isMissing) {
      return {
        path: targetRel,
        absolute: abs,
        applied: false,
        reason: `cannot read target: ${err.message}`,
        addedLines: counts.added,
        removedLines: counts.removed,
        existed: false
      };
    }
  }
  const patched = applyPatch(originalContent, hunkFile, { fuzzFactor });
  if (patched === false) {
    return {
      path: targetRel,
      absolute: abs,
      applied: false,
      reason: `hunk(s) did not match (fuzzFactor=${fuzzFactor})`,
      addedLines: counts.added,
      removedLines: counts.removed,
      originalContent,
      existed
    };
  }
  return {
    path: targetRel,
    absolute: abs,
    applied: true,
    addedLines: counts.added,
    removedLines: counts.removed,
    originalContent,
    existed
  };
}
function pickTargetPath(hunkFile, stripComponents) {
  const raw = typeof hunkFile.newFileName === "string" && hunkFile.newFileName !== "/dev/null" ? hunkFile.newFileName : hunkFile.oldFileName ?? "";
  return stripPathComponents(raw, stripComponents);
}
function stripPathComponents(p, n) {
  if (n <= 0) return p;
  const parts = p.split(/[\\/]/);
  return parts.slice(Math.min(n, parts.length - 1)).join("/");
}
function countPatchLines(hunkFile) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunkFile.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}
export {
  dryRunFile
};
