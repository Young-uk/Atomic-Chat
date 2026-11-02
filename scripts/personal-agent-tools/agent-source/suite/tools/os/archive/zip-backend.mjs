import { validateZipDirectory, boundedZipRead } from "./archive-budget.mjs";
import { mkdir, writeFile, symlink, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import JSZip from "jszip";
import {
  ExtractBudget,
  describeSanitizationError,
  sanitizeEntryPath
} from "./archive-safety.mjs";
class ZipBackend {
  format = "zip";
  async list(data) {
    validateZipDirectory(data);
    const zip = await JSZip.loadAsync(data);
    const entries = [];
    for (const [name, file] of Object.entries(zip.files)) {
      const kind = classifyZipEntry(name, file);
      const entry = {
        path: stripTrailingSlash(name),
        kind,
        mtime: file.date
      };
      const rawSize = file._data?.uncompressedSize;
      if (typeof rawSize === "number") entry.size = rawSize;
      const rawCompressed = file._data?.compressedSize;
      if (typeof rawCompressed === "number")
        entry.compressedSize = rawCompressed;
      if (kind === "symlink") {
        entry.linkTarget = (await boundedZipRead(file, 65536)).toString("utf8").trim();
      }
      entries.push(entry);
    }
    return entries;
  }
  async readEntry(data, path) {
    validateZipDirectory(data);
    const zip = await JSZip.loadAsync(data);
    const file = zip.file(path);
    if (!file || file.dir) {
      throw new Error(`entry not found or is a directory: ${path}`);
    }
    const nodeBuf = await boundedZipRead(file);
    return nodeBuf;
  }
  async extract(data, options) {
    validateZipDirectory(data);
    const zip = await JSZip.loadAsync(data);
    const budget = new ExtractBudget(options.limits);
    const report = {
      extractedEntries: 0,
      totalBytesWritten: 0,
      skippedEntries: [],
      warnings: []
    };
    const includeMatches = (p) => !options.include || options.include.length === 0 ? true : options.include.some(
      (prefix) => p === prefix || p.startsWith(prefix + "/")
    );
    for (const [rawName, file] of Object.entries(zip.files)) {
      const kind = classifyZipEntry(rawName, file);
      const sanitized = sanitizeEntryPath(options.destDir, rawName);
      if (!sanitized.ok) {
        report.skippedEntries.push({
          path: rawName,
          reason: describeSanitizationError(rawName, sanitized.error)
        });
        continue;
      }
      if (!includeMatches(sanitized.value.normalised)) continue;
      if (kind === "directory") {
        await mkdir(sanitized.value.absolute, { recursive: true });
        continue;
      }
      if (kind === "symlink") {
        if (!options.followSymlinks) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: "symlink entries require followSymlinks=true"
          });
          continue;
        }
        const target = (await boundedZipRead(file, 65536)).toString("utf8").trim();
        const linkParent = dirname(sanitized.value.normalised);
        const resolvedTarget = sanitizeEntryPath(
          options.destDir,
          linkParent === "." ? target : `${linkParent}/${target}`
        );
        if (!resolvedTarget.ok) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: `symlink target escapes destDir: ${target}`
          });
          continue;
        }
        await mkdir(dirname(sanitized.value.absolute), { recursive: true });
        try {
          await symlink(target, sanitized.value.absolute);
          report.extractedEntries++;
        } catch (err) {
          report.warnings.push(
            `failed to create symlink ${sanitized.value.normalised}: ${err.message}`
          );
        }
        continue;
      }
      const nodeBuf = await boundedZipRead(file);
      const decision = budget.chargeEntry(nodeBuf.length);
      if (!decision.ok) {
        report.skippedEntries.push({
          path: sanitized.value.normalised,
          reason: decision.reason
        });
        continue;
      }
      if (!options.overwrite && await pathExists(sanitized.value.absolute)) {
        report.skippedEntries.push({
          path: sanitized.value.normalised,
          reason: "destination exists and overwrite=false"
        });
        continue;
      }
      await mkdir(dirname(sanitized.value.absolute), { recursive: true });
      await writeFile(sanitized.value.absolute, nodeBuf);
      report.extractedEntries++;
      report.totalBytesWritten += nodeBuf.length;
    }
    return report;
  }
}
function classifyZipEntry(name, file) {
  if (file.dir || name.endsWith("/")) return "directory";
  if (isUnixSymlink(file)) return "symlink";
  return "file";
}
function isUnixSymlink(file) {
  const ext = file.unixPermissions;
  if (typeof ext !== "number") return false;
  return (ext & 61440) === 40960;
}
function stripTrailingSlash(p) {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}
async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
export {
  ZipBackend
};
