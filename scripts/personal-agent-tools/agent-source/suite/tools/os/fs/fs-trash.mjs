import { OS_FS_TRASH_CONTRACT, parseTrashArgs } from "./fs-trash-contract.mjs";
import { stat } from "node:fs/promises";
import { platform } from "node:os";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { runCommand } from "../../../sandbox/command-runner.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
function escapeAppleScriptDoubleQuotedSegment(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function escapePowerShellSingleQuoted(s) {
  return s.replace(/'/g, "''");
}
async function trashOneDarwin(absolutePath, signal) {
  const inner = escapeAppleScriptDoubleQuotedSegment(absolutePath);
  const script = `tell application "Finder" to delete POSIX file "${inner}"`;
  const result = await runCommand("osascript", ["-e", script], {
    cwd: process.cwd(),
    timeoutMs: 12e4,
    signal
  });
  if (result.exitCode !== 0) {
    const err = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    return { ok: false, message: err || `osascript exit ${result.exitCode}` };
  }
  return { ok: true };
}
async function trashPathsLinux(paths, signal) {
  const result = await runCommand("gio", ["trash", ...paths], {
    cwd: process.cwd(),
    timeoutMs: 12e4,
    signal
  });
  if (result.exitCode === 0) return { ok: true };
  const result2 = await runCommand("trash-put", paths, {
    cwd: process.cwd(),
    timeoutMs: 12e4,
    signal
  });
  if (result2.exitCode === 0) return { ok: true };
  const msg = [result.stderr, result2.stderr].filter(Boolean).join(" | ").trim();
  return {
    ok: false,
    message: msg || "neither `gio trash` nor `trash-put` succeeded (install trash-cli?)"
  };
}
async function trashOneWindows(absolutePath, isDir, signal) {
  const escaped = escapePowerShellSingleQuoted(absolutePath);
  const api = isDir ? "DeleteDirectory" : "DeleteFile";
  const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${api}('${escaped}','OnlyErrorDialogs','SendToRecycleBin')`;
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { cwd: process.cwd(), timeoutMs: 12e4, signal }
  );
  if (result.exitCode !== 0) {
    const err = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    return { ok: false, message: err || `powershell exit ${result.exitCode}` };
  }
  return { ok: true };
}
async function trashPaths(absolutes, signal) {
  const os = platform();
  if (os === "darwin") {
    for (let i = 0; i < absolutes.length; i++) {
      const r = await trashOneDarwin(absolutes[i], signal);
      if (!r.ok) return { ok: false, index: i, message: r.message };
    }
    return { ok: true };
  }
  if (os === "linux") {
    const r = await trashPathsLinux(absolutes, signal);
    if (!r.ok) return { ok: false, index: 0, message: r.message };
    return { ok: true };
  }
  if (os === "win32") {
    for (let i = 0; i < absolutes.length; i++) {
      const p = absolutes[i];
      const st = await stat(p);
      const r = await trashOneWindows(p, st.isDirectory(), signal);
      if (!r.ok) return { ok: false, index: i, message: r.message };
    }
    return { ok: true };
  }
  return {
    ok: false,
    index: 0,
    message: `os.fs.trash: unsupported platform ${os}`
  };
}
function buildOsFsTrashTool(options) {
  return {
    name: OS_FS_TRASH_CONTRACT.name,
    description: OS_FS_TRASH_CONTRACT.description,
    readonly: OS_FS_TRASH_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const { paths } = parseTrashArgs(rawArgs);
      const absolutes = paths.map((p) => resolveUserPath(p, ctx.workingDir));
      const preview = absolutes.length <= 12 ? absolutes.join("\n") : `${absolutes.slice(0, 12).join("\n")}
\u2026 +${absolutes.length - 12} more`;
      await requireFsApproval(
        options,
        {
          kind: "trash",
          paths: absolutes,
          sessionId: ctx.sessionId,
          tool: "os.fs.trash",
          reason: `move ${absolutes.length} path(s) to Trash`,
          preview,
          affectedResources: absolutes,
          targetPaths: absolutes,
          workingDir: ctx.workingDir,
          trustConfigPaths: options.trustConfigPaths
        },
        ctx.signal
      );
      for (const abs of absolutes) {
        try {
          await stat(abs);
        } catch {
          return compressToolResult({
            tool: "os.fs.trash",
            status: "error",
            output: `path not found: ${abs}`,
            details: { path: abs }
          });
        }
      }
      const outcome = await trashPaths(absolutes, ctx.signal);
      if (!outcome.ok) {
        return compressToolResult({
          tool: "os.fs.trash",
          status: "error",
          output: `trash failed at index ${outcome.index}: ${outcome.message}`,
          details: { failedIndex: outcome.index, message: outcome.message }
        });
      }
      return compressToolResult({
        tool: "os.fs.trash",
        status: "ok",
        output: `moved ${absolutes.length} path(s) to Trash`,
        details: { count: absolutes.length, paths: absolutes }
      });
    }
  };
}
export {
  buildOsFsTrashTool
};
