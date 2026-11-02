import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  parseFormatOverride,
  resolveArchive
} from "./archive-resolver.mjs";
const DEFAULT_MAX_BYTES = 256 * 1024;
const ENTRY_SUMMARY_MAX_CHARS = 8e3;
function buildOsFsArchiveReadEntryTool(options = {}) {
  return {
    name: "os.fs.archive.read_entry",
    description: "Read a single entry from an archive without extracting to disk. Returns the body as UTF-8 text (default) or base64. Read-only.",
    readonly: true,
    async run(rawArgs, ctx) {
      const path = rawArgs.path;
      const entry = rawArgs.entry;
      if (typeof path !== "string" || path.length === 0) {
        throw new Error(
          "os.fs.archive.read_entry: `path` must be a non-empty string"
        );
      }
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(
          "os.fs.archive.read_entry: `entry` must be a non-empty string"
        );
      }
      const as = parseAs(rawArgs.as);
      const maxBytes = parseMaxBytes(rawArgs.maxBytes);
      const formatOverride = parseFormatOverride(rawArgs.format);
      const resolved = await resolveArchive(
        path,
        ctx.workingDir,
        formatOverride,
        options.backends
      );
      const body = await resolved.backend.readEntry(resolved.data, entry);
      const truncated = body.length > maxBytes;
      const trimmed = truncated ? body.subarray(0, maxBytes) : body;
      const { text, encoding, warning } = encodeBody(trimmed, as);
      const details = {
        path: resolved.absolute,
        entry,
        format: resolved.format,
        bytes: body.length,
        truncated,
        encoding
      };
      if (warning) details.warning = warning;
      return compressToolResult(
        {
          tool: "os.fs.archive.read_entry",
          status: "ok",
          output: text,
          details
        },
        {
          maxSummaryLength: Math.min(maxBytes, ENTRY_SUMMARY_MAX_CHARS),
          maxTailLines: 5e3
        }
      );
    }
  };
}
function parseAs(raw) {
  if (raw === void 0 || raw === null) return "utf8";
  if (raw === "utf8" || raw === "base64") return raw;
  throw new Error("os.fs.archive.read_entry: `as` must be 'utf8' or 'base64'");
}
function parseMaxBytes(raw) {
  if (raw === void 0 || raw === null) return DEFAULT_MAX_BYTES;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      "os.fs.archive.read_entry: `maxBytes` must be a positive number"
    );
  }
  return Math.floor(raw);
}
function encodeBody(data, mode) {
  if (mode === "base64") {
    return { text: data.toString("base64"), encoding: "base64" };
  }
  const probe = data.subarray(0, Math.min(data.length, 4096));
  const hasNul = probe.includes(0);
  if (hasNul) {
    return {
      text: data.toString("base64"),
      encoding: "base64",
      warning: "entry contains NUL bytes; returned as base64"
    };
  }
  return { text: data.toString("utf8"), encoding: "utf8" };
}
export {
  buildOsFsArchiveReadEntryTool
};
