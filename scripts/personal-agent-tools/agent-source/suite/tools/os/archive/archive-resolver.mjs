import { PERSONAL_ARCHIVE_INPUT_BYTES } from "./archive-budget.mjs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { resolveUserPath } from "../expand-home.mjs";
import { detectArchiveFormat } from "./format-detector.mjs";
import { ZipBackend } from "./zip-backend.mjs";
import { TarBackend } from "./tar-backend.mjs";
import { GzipBackend } from "./gz-backend.mjs";
async function resolveArchive(path, workingDir, formatOverride, factories = {}) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("archive: `path` must be a non-empty string");
  }
  const absolute = resolveUserPath(path, workingDir);
  const info = await stat(absolute);
  if (!info.isFile()) {
    throw new Error(`archive: ${absolute} is not a regular file`);
  }
  if (info.size > PERSONAL_ARCHIVE_INPUT_BYTES) throw new Error("Archive input exceeds the Personal byte budget");
  const data = await readFile(absolute);
  const filename = basename(absolute);
  const head = data.subarray(0, Math.min(data.length, 512));
  const format = formatOverride ?? detectArchiveFormat(filename, Buffer.from(head));
  if (!format) {
    throw new Error(
      `archive: could not detect format for ${filename} (supported: zip, tar, tar.gz, gz)`
    );
  }
  const backend = instantiateBackend(format, filename, factories);
  return { absolute, filename, data, format, backend };
}
function instantiateBackend(format, filename, factories) {
  switch (format) {
    case "zip":
      return factories.zip?.() ?? new ZipBackend();
    case "tar":
      return factories.tar?.() ?? new TarBackend("tar");
    case "tar.gz":
      return factories["tar.gz"]?.() ?? new TarBackend("tar.gz");
    case "gz":
      return factories.gz?.(filename) ?? new GzipBackend(filename);
  }
}
function parseFormatOverride(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") {
    throw new Error("archive: `format` must be a string");
  }
  const normalised = raw.toLowerCase();
  if (normalised === "zip" || normalised === "tar" || normalised === "tar.gz" || normalised === "gz") {
    return normalised;
  }
  throw new Error(`archive: unknown format override ${JSON.stringify(raw)}`);
}
export {
  parseFormatOverride,
  resolveArchive
};
