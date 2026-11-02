import { OS_FS_RESTORE_CONTRACT, parseRestoreArgs } from "./fs-restore-contract.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { formatBytes, formatLines } from "./fs-replace-guard.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
const PREVIEW_MAX_LEN = 400;
function buildOsFsRestoreTool(options) {
  return {
    name: OS_FS_RESTORE_CONTRACT.name,
    description: OS_FS_RESTORE_CONTRACT.description,
    readonly: OS_FS_RESTORE_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const { path } = parseRestoreArgs(rawArgs);
      const store = options.restore;
      if (store === void 0) {
        throw new Error(
          "os.fs.restore: this runtime keeps no restore copies (no state directory)"
        );
      }
      const absolute = resolveUserPath(path, ctx.workingDir);
      const copy = await store.latestCopy(ctx.workingDir, absolute);
      if (copy === null) {
        throw new Error(
          `os.fs.restore: nothing saved for \`${path}\` in this working directory \u2014 only a pre-existing file replaced by os.fs.write / edit / patch / move (by any session working here) has a copy`
        );
      }
      let content;
      try {
        content = await store.readCopy(ctx.workingDir, copy);
      } catch {
        throw new Error(
          `os.fs.restore: the saved copy of \`${path}\` is gone (${copy.file})`
        );
      }
      const text = content.toString("utf8");
      const preview = text.length > PREVIEW_MAX_LEN ? `${text.slice(0, PREVIEW_MAX_LEN)}\u2026` : text;
      await requireFsApproval(
        options,
        {
          kind: "write",
          paths: [absolute],
          sessionId: ctx.sessionId,
          tool: "os.fs.restore",
          reason: `restore ${absolute} to the ${formatBytes(copy.bytes)} (${formatLines(copy.lines)}) it held before ${copy.tool}`,
          preview,
          affectedResources: [absolute],
          targetPaths: [absolute],
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content);
      return compressToolResult({
        tool: "os.fs.restore",
        status: "ok",
        output: `restored \`${path}\` from the copy saved before ${copy.tool}: ${formatBytes(copy.bytes)}, ${formatLines(copy.lines)}`,
        details: {
          path: absolute,
          bytes: copy.bytes,
          lines: copy.lines,
          savedAt: copy.savedAt,
          savedBefore: copy.tool,
          savedBy: copy.sessionId,
          copy: copy.file
        }
      });
    }
  };
}
export {
  buildOsFsRestoreTool
};
