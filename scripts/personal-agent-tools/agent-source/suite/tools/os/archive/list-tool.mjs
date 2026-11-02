import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import {
  parseFormatOverride,
  resolveArchive
} from "./archive-resolver.mjs";
const ARCHIVE_SUMMARY_MAX_CHARS = 6e3;
const LISTING_MAX_ENTRIES = 120;
function buildOsFsArchiveListTool(options = {}) {
  return {
    name: "os.fs.archive.list",
    description: "List entries inside an archive (zip, tar, tar.gz/tgz, gz) without extracting. Read-only.",
    readonly: true,
    async run(rawArgs, ctx) {
      const path = rawArgs.path;
      if (typeof path !== "string" || path.length === 0) {
        throw new Error(
          "os.fs.archive.list: `path` must be a non-empty string"
        );
      }
      const formatOverride = parseFormatOverride(rawArgs.format);
      const resolved = await resolveArchive(
        path,
        ctx.workingDir,
        formatOverride,
        options.backends
      );
      const entries = await resolved.backend.list(resolved.data);
      const output = formatListing(entries);
      return compressToolResult(
        {
          tool: "os.fs.archive.list",
          status: "ok",
          output,
          details: {
            path: resolved.absolute,
            format: resolved.format,
            entryCount: entries.length,
            totalUncompressedBytes: totalSize(entries),
            entries: entries.map((e) => ({
              path: e.path,
              kind: e.kind,
              size: e.size,
              compressedSize: e.compressedSize,
              linkTarget: e.linkTarget
            }))
          }
        },
        // `formatListing` has already clipped to these bounds and said so
        // in the text; passing them on keeps the compressor from cutting
        // a second time and losing the line that names what was hidden.
        {
          maxSummaryLength: ARCHIVE_SUMMARY_MAX_CHARS,
          maxTailLines: LISTING_MAX_ENTRIES + 1
        }
      );
    }
  };
}
function formatListing(entries) {
  if (entries.length === 0) return "(empty archive)";
  const lines = entries.map((e) => {
    const size = e.size === void 0 ? "-" : String(e.size);
    const kind = kindLetter(e.kind);
    const target = e.linkTarget ? ` -> ${e.linkTarget}` : "";
    return `${kind} ${size.padStart(10, " ")}  ${e.path}${target}`;
  });
  return clipListing(lines);
}
function clipListing(lines) {
  const budget = ARCHIVE_SUMMARY_MAX_CHARS - hiddenEntriesNote(lines.length).length - 1;
  let kept = 0;
  let chars = 0;
  while (kept < lines.length && kept < LISTING_MAX_ENTRIES) {
    const next = chars + (kept > 0 ? 1 : 0) + lines[kept].length;
    if (next > budget) break;
    chars = next;
    kept += 1;
  }
  if (kept >= lines.length) return lines.join("\n");
  const shown = Math.max(1, kept);
  return [
    ...lines.slice(0, shown),
    hiddenEntriesNote(lines.length - shown)
  ].join("\n");
}
function hiddenEntriesNote(hidden) {
  return `\u2026 ${hidden} more ${hidden === 1 ? "entry" : "entries"} not shown (listing clipped; entries are in archive order)`;
}
function kindLetter(kind) {
  switch (kind) {
    case "file":
      return "-";
    case "directory":
      return "d";
    case "symlink":
      return "l";
  }
}
function totalSize(entries) {
  let total = 0;
  for (const e of entries) {
    if (typeof e.size === "number") total += e.size;
  }
  return total;
}
export {
  ARCHIVE_SUMMARY_MAX_CHARS,
  buildOsFsArchiveListTool
};
