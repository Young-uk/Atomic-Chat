import { OS_FS_EDIT_CONTRACT, parseEditArgs as parseArgs } from "./fs-edit-contract.mjs";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  compressToolResult,
  retainToolOutput
} from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { checkChangedFile } from "./fs-content-check.mjs";
import {
  clampDiffPreview,
  DIFF_SUMMARY_MAX_CHARS,
  DIFF_SUMMARY_MAX_LINES,
  renderUnifiedDiff
} from "./fs-edit-diff.mjs";
import { nearestFragment } from "./fs-edit-match.mjs";
import {
  findTolerantEditMatch,
  tolerantAmbiguityMessage,
  tolerantMatchNote
} from "./fs-edit-tolerant.mjs";
import { refuseMaskedSecretWrite } from "./fs-masked-secret-guard.mjs";
import { withParseWarning } from "./fs-parse-check.mjs";
import {
  guardReplacedFile,
  priorFromText,
  withReplaceNotes
} from "./fs-replace-guard.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
import {
  changedSinceRead,
  recordOwnWrite,
  withStaleReadError,
  withStaleReadNotice
} from "./fs-read-freshness.mjs";
function buildOsFsEditTool(options) {
  return {
    name: OS_FS_EDIT_CONTRACT.name,
    description: OS_FS_EDIT_CONTRACT.description,
    readonly: OS_FS_EDIT_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const args = parseArgs(rawArgs);
      const absolute = resolveUserPath(args.path, ctx.workingDir);
      const changed = await changedSinceRead(ctx.fileVersions, absolute);
      try {
        return withStaleReadNotice(
          await editFile(options, args, absolute, ctx),
          changed
        );
      } catch (err) {
        throw withStaleReadError(err, changed, "os.fs.edit");
      }
    }
  };
}
async function editFile(options, args, absolute, ctx) {
  const info = await stat(absolute);
  if (!info.isFile()) {
    throw new Error(`os.fs.edit: ${absolute} is not a regular file`);
  }
  const original = await readFile(absolute, "utf8");
  const exact = countOccurrences(original, args.oldString);
  const loose = exact === 0 ? resolveTolerantMatch(original, args.oldString, args.newString) : null;
  const occurrences = exact === 0 ? 1 : exact;
  if (occurrences > 1 && !args.replaceAll) {
    throw new Error(
      `os.fs.edit: \`oldString\` is not unique (found ${occurrences} occurrences). Provide more surrounding context to make it unique, or set \`replaceAll=true\`.`
    );
  }
  const updated = loose !== null ? original.slice(0, loose.match.start) + loose.replacement + original.slice(loose.match.end) : args.replaceAll ? replaceAll(original, args.oldString, args.newString) : replaceOnce(original, args.oldString, args.newString);
  refuseMaskedSecretWrite("os.fs.edit", args.path, original, updated);
  const diff = renderUnifiedDiff(original, updated, absolute);
  const preview = clampDiffPreview(diff);
  await requireFsApproval(
    options,
    {
      kind: "write",
      paths: [absolute],
      sessionId: ctx.sessionId,
      tool: "os.fs.edit",
      reason: `edit ${occurrences} occurrence${occurrences > 1 ? "s" : ""} in ${absolute}`,
      preview,
      affectedResources: [absolute],
      workingDir: ctx.workingDir,
      trustConfigPaths: options.trustConfigPaths
    },
    ctx.signal
  );
  await atomicWrite(absolute, updated);
  await recordOwnWrite(ctx.fileVersions, absolute);
  const guard = await guardReplacedFile({
    store: options.restore,
    sessionId: ctx.sessionId,
    workingDir: ctx.workingDir,
    absolute,
    display: args.path,
    tool: "os.fs.edit",
    change: "shrink",
    prior: priorFromText(original),
    after: updated
  });
  const replacedOccurrences = args.replaceAll && loose === null ? occurrences : 1;
  const parseWarning = checkChangedFile({
    absolute,
    workingDir: ctx.workingDir,
    change: "edit",
    before: original,
    after: updated,
    replacedOccurrences
  });
  return withReplaceNotes(
    withParseWarning(
      withLooseMatchNote(
        // The diff is already clipped, by `renderUnifiedDiff`, to a
        // length chosen for diffs. Left to its defaults the compressor
        // would undo that considered cap with one that knows nothing
        // about them — 12 tail lines and 385 chars — so we pass the
        // renderer's own bounds instead (see `fs-edit-diff.ts`).
        compressToolResult(
          {
            tool: "os.fs.edit",
            status: "ok",
            output: diff.length > 0 ? diff : `(no textual diff \u2014 file rewritten)`,
            details: {
              path: absolute,
              replacedOccurrences,
              replaceAll: args.replaceAll,
              sizeBefore: Buffer.byteLength(original, "utf8"),
              sizeAfter: Buffer.byteLength(updated, "utf8")
            }
          },
          {
            maxSummaryLength: DIFF_SUMMARY_MAX_CHARS,
            maxTailLines: DIFF_SUMMARY_MAX_LINES
          }
        ),
        loose
      ),
      parseWarning
    ),
    [guard]
  );
}
const LOOSE_MATCH_NOTE = tolerantMatchNote("whitespace");
function withLooseMatchNote(result, loose) {
  if (loose === null) return result;
  const note = tolerantMatchNote(loose.level, loose.reindented);
  return retainToolOutput(
    result,
    {
      ...result,
      summary: `${note}
${result.summary}`,
      details: { ...result.details, matchedBy: loose.level }
    },
    { prefix: `${note}
` }
  );
}
function resolveTolerantMatch(original, oldString, newString) {
  const lookup = findTolerantEditMatch(original, oldString, newString);
  if (lookup.kind === "unique") return lookup;
  if (lookup.kind === "ambiguous") {
    throw new Error(tolerantAmbiguityMessage(lookup.level, lookup.count));
  }
  const fragment = nearestFragment(original, oldString);
  throw new Error(
    fragment === null ? "os.fs.edit: `oldString` was not found in the target file. Provide the exact substring (including whitespace/indent). For a rename, a one-line oldString with replaceAll: true is safer." : `os.fs.edit: \`oldString\` was not found in the target file.
Nearest text in the file, as JSON: ${fragment}. Copy it exactly (blank lines and indentation included), or use a shorter one-line oldString.`
  );
}
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
function replaceOnce(source, oldString, newString) {
  const idx = source.indexOf(oldString);
  if (idx === -1) return source;
  return source.slice(0, idx) + newString + source.slice(idx + oldString.length);
}
function replaceAll(source, oldString, newString) {
  const parts = [];
  let cursor = 0;
  while (true) {
    const idx = source.indexOf(oldString, cursor);
    if (idx === -1) {
      parts.push(source.slice(cursor));
      break;
    }
    parts.push(source.slice(cursor, idx));
    parts.push(newString);
    cursor = idx + oldString.length;
  }
  return parts.join("");
}
async function atomicWrite(target, content) {
  const dir = dirname(target);
  const suffix = randomBytes(6).toString("hex");
  const temp = resolve(dir, `.${suffix}.atomic-agent.tmp`);
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, target);
  } catch (err) {
    try {
      await unlink(temp);
    } catch {
    }
    throw err;
  }
}
export {
  LOOSE_MATCH_NOTE,
  buildOsFsEditTool
};
