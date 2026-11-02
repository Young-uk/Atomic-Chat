import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function loadCooldownFile(filePath, now, maxMs) {
  const entries = /* @__PURE__ */ new Map();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return entries;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return entries;
  }
  for (const [name, raw] of Object.entries(parsed)) {
    const entry = raw;
    if (typeof entry?.until !== "number" || !Number.isFinite(entry.until) || typeof entry.strikes !== "number" || !Number.isFinite(entry.strikes)) {
      continue;
    }
    if (entry.until + 2 * maxMs <= now) continue;
    entries.set(name, {
      until: entry.until,
      strikes: entry.strikes,
      // Files from before tags existed have none: untagged, as before.
      ...entry.tag === "keyless" || entry.tag === "keyed" ? { tag: entry.tag } : {}
    });
  }
  return entries;
}
function saveCooldownFile(filePath, entries) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)), "utf8");
    renameSync(tmp, filePath);
  } catch {
  }
}
export {
  loadCooldownFile,
  saveCooldownFile
};
