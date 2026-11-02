import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
const COPY_BASENAME_MAX = 200;
const KEY_HEX_CHARS = 32;
function restoreKey(workingDir) {
  return createHash("sha256").update(resolve(workingDir)).digest("hex").slice(0, KEY_HEX_CHARS);
}
function safeSegment(id) {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length === 0 ? "_" : safe;
}
function emptyManifest(workingDir) {
  return { version: 2, workingDir: resolve(workingDir), next: 1, copies: [] };
}
function normalizeManifest(raw, workingDir) {
  if (typeof raw !== "object" || raw === null) return emptyManifest(workingDir);
  const record = raw;
  const copies = Array.isArray(record.copies) ? record.copies.filter(isRestoreCopy) : [];
  const highest = copies.reduce((max, copy) => Math.max(max, copy.n), 0);
  const next = typeof record.next === "number" && Number.isInteger(record.next) ? Math.max(record.next, highest + 1) : highest + 1;
  return { ...emptyManifest(workingDir), next, copies };
}
function normalizeSession(raw) {
  const record = typeof raw === "object" && raw !== null ? raw : {};
  const created = Array.isArray(record.created) ? record.created.filter((p) => typeof p === "string") : [];
  return { version: 1, created };
}
function isRestoreCopy(value) {
  if (typeof value !== "object" || value === null) return false;
  const copy = value;
  return typeof copy.n === "number" && typeof copy.path === "string" && typeof copy.file === "string" && typeof copy.bytes === "number" && typeof copy.lines === "number" && typeof copy.savedAt === "number" && typeof copy.tool === "string" && typeof copy.sessionId === "string";
}
async function writeJsonAtomically(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), "utf8");
  await rename(temp, file);
}
async function writeCopyExclusively(dir, from, absolute, content) {
  const name = basename(absolute).slice(0, COPY_BASENAME_MAX);
  for (let n = from; ; n++) {
    const file = `${n}-${name}`;
    try {
      await writeFile(join(dir, file), content, { flag: "wx" });
      return { n, file };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}
export {
  emptyManifest,
  normalizeManifest,
  normalizeSession,
  restoreKey,
  safeSegment,
  writeCopyExclusively,
  writeJsonAtomically
};
