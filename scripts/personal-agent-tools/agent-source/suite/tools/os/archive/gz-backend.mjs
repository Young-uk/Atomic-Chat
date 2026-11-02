import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { ExtractBudget } from "./archive-safety.mjs";
class GzipBackend {
  constructor(sourceFilename) {
    this.sourceFilename = sourceFilename;
  }
  format = "gz";
  async list(data) {
    const decompressed = gunzipSync(data, { maxOutputLength: 10 * 1024 * 1024 });
    const entryName = stripGzSuffix(this.sourceFilename);
    return [
      {
        path: entryName,
        kind: "file",
        size: decompressed.length,
        compressedSize: data.length
      }
    ];
  }
  async readEntry(data, path) {
    const entryName = stripGzSuffix(this.sourceFilename);
    if (path !== entryName) {
      throw new Error(
        `entry not found: ${path} (gz contains only ${entryName})`
      );
    }
    return gunzipSync(data, { maxOutputLength: 10 * 1024 * 1024 });
  }
  async extract(data, options) {
    const budget = new ExtractBudget(options.limits);
    const report = {
      extractedEntries: 0,
      totalBytesWritten: 0,
      skippedEntries: [],
      warnings: []
    };
    const entryName = stripGzSuffix(this.sourceFilename);
    const target = join(options.destDir, entryName);
    const decompressed = gunzipSync(data, { maxOutputLength: 10 * 1024 * 1024 });
    const decision = budget.chargeEntry(decompressed.length);
    if (!decision.ok) {
      report.skippedEntries.push({ path: entryName, reason: decision.reason });
      return report;
    }
    if (!options.overwrite && await pathExists(target)) {
      report.skippedEntries.push({
        path: entryName,
        reason: "destination exists and overwrite=false"
      });
      return report;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, decompressed);
    report.extractedEntries = 1;
    report.totalBytesWritten = decompressed.length;
    return report;
  }
}
function stripGzSuffix(filename) {
  const base = basename(filename);
  return base.toLowerCase().endsWith(".gz") ? base.slice(0, -3) : base;
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
  GzipBackend
};
