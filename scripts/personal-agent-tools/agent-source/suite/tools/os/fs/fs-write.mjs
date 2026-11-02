import { OS_FS_WRITE_CONTRACT, parseWriteArgs } from "./fs-write-contract.mjs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { categorizeFsMutation } from "./fs-approval-scope.mjs";
import { checkChangedFile } from "./fs-content-check.mjs";
import {
  checkInputReplacement,
  refuseInputReplacement
} from "./fs-input-guard.mjs";
import { refuseMaskedSecretWrite } from "./fs-masked-secret-guard.mjs";
import { PARSE_CHECK_MAX_CHARS, withParseWarning } from "./fs-parse-check.mjs";
import {
  NO_REPLACE_NOTE,
  countLines,
  formatBytes,
  formatLines,
  formatNumber,
  guardReplacedFile,
  readPriorFile,
  withReplaceNotes
} from "./fs-replace-guard.mjs";
import {
  changedSinceRead,
  recordOwnWrite,
  withStaleReadNotice
} from "./fs-read-freshness.mjs";
import {
  requireFsApproval
} from "./fs-require-approval.mjs";
const MAX_REDIRECTS = 3;
function buildOsFsWriteTool(options) {
  return {
    name: OS_FS_WRITE_CONTRACT.name,
    description: OS_FS_WRITE_CONTRACT.description,
    readonly: OS_FS_WRITE_CONTRACT.readonly,
    async run(rawArgs, ctx) {
      const { path, content, mode, overwrite } = parseWriteArgs(rawArgs);
      const absolute = resolveUserPath(path, ctx.workingDir);
      const existing = await readPriorFile(absolute);
      const priorText = existing?.content?.toString("utf8") ?? "";
      refuseMaskedSecretWrite(
        "os.fs.write",
        path,
        priorText,
        mode === "append" ? priorText + content : content
      );
      if (mode === "replace") {
        if (existing !== null) {
          const refused = await checkInputReplacement({
            store: options.restore,
            sessionId: ctx.sessionId,
            absolute,
            display: path,
            prior: existing,
            after: content,
            request: options.resolveOriginalRequest?.(ctx.sessionId),
            previousReply: options.resolvePreviousReply?.(ctx.sessionId),
            declaredInputs: options.declaredInputs?.inputsOf(ctx.sessionId),
            overwrite
          });
          if (refused !== null) return refuseInputReplacement("os.fs.write", refused);
        }
      }
      const preview = content.length > 400 ? `${content.slice(0, 400)}\u2026` : content;
      let target = absolute;
      let redirects = 0;
      for (; ; ) {
        const outcome = await requireFsApproval(
          options,
          {
            kind: "write",
            paths: [target],
            sessionId: ctx.sessionId,
            tool: "os.fs.write",
            reason: `${mode} ${content.length} bytes into ${target}`,
            preview,
            affectedResources: [target],
            redirectablePath: target,
            // An append adds to the file rather than replacing it, so a
            // no to it is not a no to every later write of the file.
            targetPaths: mode === "replace" ? [target] : [],
            workingDir: ctx.workingDir,
            trustConfigPaths: options.trustConfigPaths
          },
          ctx.signal
        );
        if (outcome.pathOverride === void 0) break;
        const typed = outcome.pathOverride.trim();
        if (typed.length === 0) {
          throw new Error(
            "os.fs.write: empty target path from the approval prompt"
          );
        }
        if (++redirects > MAX_REDIRECTS) {
          throw new Error(
            `os.fs.write: target redirected more than ${MAX_REDIRECTS} times`
          );
        }
        const next = resolveUserPath(typed, ctx.workingDir);
        const nextCategory = await categorizeFsMutation("write", [next], {
          workingDir: ctx.workingDir,
          ...options.trustConfigPaths !== void 0 ? { trustConfigPaths: options.trustConfigPaths } : {}
        });
        if (nextCategory === "trust_config") {
          throw new Error(
            `os.fs.write: refusing to redirect into the agent's own config: ${next}`
          );
        }
        target = next;
        if (nextCategory === outcome.category) break;
      }
      const prior = await readPriorFile(target);
      const changed = mode === "replace" && await changedSinceRead(ctx.fileVersions, target);
      await mkdir(dirname(target), { recursive: true });
      if (mode === "append") {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(target, content, "utf8");
      } else {
        await writeFile(target, content, "utf8");
      }
      await recordOwnWrite(ctx.fileVersions, target);
      const guard = prior === null ? await noteCreated(options.restore, ctx.sessionId, target) : mode === "replace" ? await guardReplacedFile({
        store: options.restore,
        sessionId: ctx.sessionId,
        workingDir: ctx.workingDir,
        absolute: target,
        display: target === absolute ? path : target,
        tool: "os.fs.write",
        change: "replace",
        prior,
        after: content
      }) : NO_REPLACE_NOTE;
      const parseWarning = await parseWarningAfterWrite(
        target,
        mode,
        content,
        ctx.workingDir
      );
      const linesAfter = countLines(content);
      const wording = describeWrite(mode, prior, linesAfter);
      return withStaleReadNotice(withReplaceNotes(
        withParseWarning(
          compressToolResult({
            tool: "os.fs.write",
            status: "ok",
            output: target === absolute ? `wrote ${content.length} bytes to ${target} (${wording})` : `wrote ${content.length} bytes to ${target} (${wording}); the operator moved this write from ${absolute}`,
            details: {
              path: target,
              bytes: content.length,
              mode,
              lines: linesAfter,
              existed: prior !== null,
              ...overwrite ? { overwrite: true } : {},
              ...prior === null ? {} : { previousBytes: prior.bytes },
              ...prior?.lines === void 0 || prior.lines === null ? {} : { previousLines: prior.lines },
              ...target === absolute ? {} : { requestedPath: absolute }
            }
          }),
          parseWarning
        ),
        [guard]
      ), changed);
    }
  };
}
function describeWrite(mode, prior, linesAfter) {
  if (mode === "append") return "append";
  if (prior === null) return `replace, new file, ${formatLines(linesAfter)}`;
  if (prior.lines === null) {
    return `replace, ${formatBytes(prior.bytes)} \u2192 ${formatLines(linesAfter)}`;
  }
  return `replace, ${formatLines(prior.lines)} \u2192 ${formatNumber(linesAfter)}`;
}
async function noteCreated(store, sessionId, target) {
  if (store !== void 0) {
    try {
      await store.recordCreated(sessionId, target);
    } catch {
    }
  }
  return NO_REPLACE_NOTE;
}
async function parseWarningAfterWrite(target, mode, content, workingDir) {
  try {
    let written = content;
    if (mode === "append") {
      if ((await stat(target)).size > PARSE_CHECK_MAX_CHARS) return null;
      written = await readFile(target, "utf8");
    }
    return checkChangedFile({
      absolute: target,
      workingDir,
      change: "write",
      after: written
    });
  } catch {
    return null;
  }
}
export {
  buildOsFsWriteTool
};
