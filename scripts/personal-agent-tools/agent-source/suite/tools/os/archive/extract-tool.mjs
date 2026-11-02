import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import {
  requireFsApproval
} from "../fs/fs-require-approval.mjs";
import { DEFAULT_EXTRACT_LIMITS } from "./archive-types.mjs";
import {
  parseFormatOverride,
  resolveArchive
} from "./archive-resolver.mjs";
import { ARCHIVE_SUMMARY_MAX_CHARS } from "./list-tool.mjs";
const REPORT_MAX_LINES = 44;
function buildOsFsArchiveExtractTool(options) {
  return {
    name: "os.fs.archive.extract",
    description: "Extract an archive (zip, tar, tar.gz/tgz, gz) into destDir. Dangerous \u2014 always requires approval. Zip-slip / symlink-escape / decompression-bomb safeguards are always on.",
    readonly: false,
    async run(rawArgs, ctx) {
      const path = rawArgs.path;
      const destRaw = rawArgs.destDir;
      if (typeof path !== "string" || path.length === 0) {
        throw new Error(
          "os.fs.archive.extract: `path` must be a non-empty string"
        );
      }
      if (typeof destRaw !== "string" || destRaw.length === 0) {
        throw new Error(
          "os.fs.archive.extract: `destDir` must be a non-empty string"
        );
      }
      const overwrite = rawArgs.overwrite === true;
      const followSymlinks = rawArgs.followSymlinks === true;
      const include = parseStringArray(rawArgs.include, "include");
      const formatOverride = parseFormatOverride(rawArgs.format);
      const limits = parseLimits(rawArgs.limits);
      const destDir = resolveUserPath(destRaw, ctx.workingDir);
      const resolved = await resolveArchive(
        path,
        ctx.workingDir,
        formatOverride,
        options.backends
      );
      await requireFsApproval(
        options,
        {
          kind: "extract",
          paths: [destDir],
          sessionId: ctx.sessionId,
          tool: "os.fs.archive.extract",
          reason: `extract ${resolved.format} ${resolved.absolute} \u2192 ${destDir}`,
          workingDir: ctx.workingDir,
          preview: buildApprovalPreview({
            source: resolved.absolute,
            dest: destDir,
            overwrite,
            followSymlinks,
            limits,
            include
          }),
          affectedResources: [destDir]
        },
        ctx.signal
      );
      const report = await resolved.backend.extract(resolved.data, {
        destDir,
        overwrite,
        followSymlinks,
        limits,
        include
      });
      const output = formatReport(report, destDir);
      return compressToolResult(
        {
          tool: "os.fs.archive.extract",
          status: "ok",
          output,
          details: {
            source: resolved.absolute,
            destDir,
            format: resolved.format,
            extractedEntries: report.extractedEntries,
            totalBytesWritten: report.totalBytesWritten,
            skippedCount: report.skippedEntries.length,
            skippedEntries: report.skippedEntries,
            warnings: report.warnings,
            limits
          }
        },
        {
          maxSummaryLength: ARCHIVE_SUMMARY_MAX_CHARS,
          maxTailLines: REPORT_MAX_LINES
        }
      );
    }
  };
}
function parseStringArray(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (!Array.isArray(raw)) {
    throw new Error(
      `os.fs.archive.extract: \`${field}\` must be an array of strings`
    );
  }
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(
        `os.fs.archive.extract: \`${field}\` entries must be non-empty strings`
      );
    }
    out.push(item);
  }
  return out;
}
function parseLimits(raw) {
  if (raw === void 0 || raw === null) return DEFAULT_EXTRACT_LIMITS;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("os.fs.archive.extract: `limits` must be an object");
  }
  const obj = raw;
  return {
    maxTotalBytes: readLimit(
      obj.maxTotalBytes,
      DEFAULT_EXTRACT_LIMITS.maxTotalBytes,
      "maxTotalBytes"
    ),
    maxEntryBytes: readLimit(
      obj.maxEntryBytes,
      DEFAULT_EXTRACT_LIMITS.maxEntryBytes,
      "maxEntryBytes"
    ),
    maxEntries: readLimit(
      obj.maxEntries,
      DEFAULT_EXTRACT_LIMITS.maxEntries,
      "maxEntries"
    )
  };
}
function readLimit(raw, fallback, field) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `os.fs.archive.extract: \`limits.${field}\` must be a positive number`
    );
  }
  return Math.floor(raw);
}
function buildApprovalPreview(args) {
  const lines = [
    `source: ${args.source}`,
    `dest:   ${args.dest}`,
    `overwrite: ${args.overwrite}`,
    `followSymlinks: ${args.followSymlinks}`,
    `limits: ${args.limits.maxTotalBytes}B total / ${args.limits.maxEntryBytes}B per entry / ${args.limits.maxEntries} entries`
  ];
  if (args.include && args.include.length > 0) {
    lines.push(`include: ${args.include.join(", ")}`);
  }
  return lines.join("\n");
}
function formatReport(report, destDir) {
  const lines = [
    `extracted ${report.extractedEntries} entries (${report.totalBytesWritten} bytes) to ${destDir}`
  ];
  if (report.skippedEntries.length > 0) {
    lines.push(`skipped ${report.skippedEntries.length} entries:`);
    for (const s of report.skippedEntries.slice(0, 20)) {
      lines.push(`  - ${s.path}: ${s.reason}`);
    }
    if (report.skippedEntries.length > 20) {
      lines.push(`  \u2026 ${report.skippedEntries.length - 20} more skipped`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push(`warnings:`);
    for (const w of report.warnings.slice(0, 20)) {
      lines.push(`  - ${w}`);
    }
  }
  return lines.join("\n");
}
export {
  buildOsFsArchiveExtractTool
};
