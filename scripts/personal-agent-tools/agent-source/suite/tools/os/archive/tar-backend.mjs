import { collectBounded } from "./archive-budget.mjs";
import { mkdir, writeFile, symlink, link, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract as tarExtractStream } from "tar-stream";
import {
  ExtractBudget,
  describeSanitizationError,
  sanitizeEntryPath
} from "./archive-safety.mjs";
class TarBackend {
  constructor(format) {
    this.format = format;
  }
  async list(data) {
    const entries = [];
    await this.walk(data, async (header, stream) => {
      for await (const _chunk of stream) void _chunk;
      const kind = mapTarType(header.type);
      if (!kind) return;
      const entry = {
        path: normaliseTarName(header.name),
        kind
      };
      if (typeof header.size === "number") entry.size = header.size;
      if (header.mtime) entry.mtime = header.mtime;
      if (kind === "symlink" && header.linkname)
        entry.linkTarget = header.linkname;
      entries.push(entry);
    });
    return entries;
  }
  async readEntry(data, path) {
    let found = null;
    await this.walk(data, async (header, stream) => {
      if (found) {
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (normaliseTarName(header.name) !== path) {
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (header.type && header.type !== "file" && header.type !== "contiguous-file") {
        throw new Error(`entry is not a regular file: ${path}`);
      }
      found = await collectBounded(stream);
    });
    if (!found) throw new Error(`entry not found: ${path}`);
    return found;
  }
  async extract(data, options) {
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
    await this.walk(data, async (header, stream) => {
      const rawName = normaliseTarName(header.name);
      const kind = mapTarType(header.type);
      if (!kind) {
        for await (const _chunk of stream) void _chunk;
        return;
      }
      const sanitized = sanitizeEntryPath(options.destDir, rawName);
      if (!sanitized.ok) {
        report.skippedEntries.push({
          path: rawName,
          reason: describeSanitizationError(rawName, sanitized.error)
        });
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (!includeMatches(sanitized.value.normalised)) {
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (kind === "directory") {
        await mkdir(sanitized.value.absolute, { recursive: true });
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (kind === "symlink") {
        if (!options.followSymlinks) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: "symlink entries require followSymlinks=true"
          });
          for await (const _chunk of stream) void _chunk;
          return;
        }
        const target = header.linkname ?? "";
        const linkParent = dirname(sanitized.value.normalised);
        const resolved = sanitizeEntryPath(
          options.destDir,
          linkParent === "." ? target : `${linkParent}/${target}`
        );
        if (!resolved.ok) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: `symlink target escapes destDir: ${target}`
          });
          for await (const _chunk of stream) void _chunk;
          return;
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
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (header.type === "link") {
        if (!options.followSymlinks) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: "hard link entries require followSymlinks=true"
          });
          for await (const _chunk of stream) void _chunk;
          return;
        }
        const target = header.linkname ?? "";
        const resolved = sanitizeEntryPath(options.destDir, target);
        if (!resolved.ok) {
          report.skippedEntries.push({
            path: sanitized.value.normalised,
            reason: `hard-link target escapes destDir: ${target}`
          });
          for await (const _chunk of stream) void _chunk;
          return;
        }
        await mkdir(dirname(sanitized.value.absolute), { recursive: true });
        try {
          await link(resolved.value.absolute, sanitized.value.absolute);
          report.extractedEntries++;
        } catch (err) {
          report.warnings.push(
            `failed to create hard link ${sanitized.value.normalised}: ${err.message}`
          );
        }
        for await (const _chunk of stream) void _chunk;
        return;
      }
      const declared = typeof header.size === "number" ? header.size : 0;
      const decision = budget.chargeEntry(declared);
      if (!decision.ok) {
        report.skippedEntries.push({
          path: sanitized.value.normalised,
          reason: decision.reason
        });
        for await (const _chunk of stream) void _chunk;
        return;
      }
      if (!options.overwrite && await pathExists(sanitized.value.absolute)) {
        report.skippedEntries.push({
          path: sanitized.value.normalised,
          reason: "destination exists and overwrite=false"
        });
        for await (const _chunk of stream) void _chunk;
        return;
      }
      const body = await collectBounded(stream);
      await mkdir(dirname(sanitized.value.absolute), { recursive: true });
      await writeFile(sanitized.value.absolute, body);
      report.extractedEntries++;
      report.totalBytesWritten += body.length;
    });
    return report;
  }
  /**
   * Walks the tar stream entry-by-entry invoking `onEntry` per record.
   * Transparently gunzips the source when `format === "tar.gz"`.
   */
  async walk(data, onEntry) {
    const source = Readable.from([data]);
    const parser = tarExtractStream();
    const pipeline = this.format === "tar.gz" ? source.pipe(createGunzip()) : source;
    pipeline.on("error", (err) => parser.destroy(err));
    pipeline.pipe(parser);
    for await (const entry of parser) {
      await onEntry(entry.header, entry);
    }
  }
}
function mapTarType(type) {
  switch (type) {
    case "file":
    case "contiguous-file":
    case "link":
      return "file";
    case "directory":
      return "directory";
    case "symlink":
      return "symlink";
    default:
      return null;
  }
}
function normaliseTarName(name) {
  const out = name.replace(/\/+$/, "");
  return out.startsWith("./") ? out.slice(2) : out;
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
  TarBackend
};
