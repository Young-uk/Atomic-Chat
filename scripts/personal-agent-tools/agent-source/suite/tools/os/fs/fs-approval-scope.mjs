import { lstat, readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
async function categorizeFsMutation(kind, absolutePaths, options) {
  if (kind !== "extract") {
    const trustPaths = options.trustConfigPaths ?? [];
    if (await touchesTrustConfig(absolutePaths, trustPaths)) {
      return "trust_config";
    }
  }
  const scope = await resolveFsScope(absolutePaths, options);
  switch (kind) {
    case "write":
      if (scope === "workspace") return "fs_write_workspace";
      if (scope === "home") return "fs_write_home";
      return "other";
    case "trash":
      return scope === "outside" ? "other" : "fs_trash";
    case "extract":
      return scope === "outside" ? "other" : "fs_write_home";
  }
}
async function resolveFsScope(absolutePaths, options) {
  if (absolutePaths.length === 0) return "outside";
  const workspaceRoot = await canonicalizeExisting(options.workingDir);
  const homeRoot = await canonicalizeExisting(options.homeDir ?? homedir());
  let combined = "workspace";
  for (const path of absolutePaths) {
    const scope = await scopeOfPath(path, workspaceRoot, homeRoot);
    if (scope === "outside") return "outside";
    if (scope === "home") combined = "home";
  }
  return combined;
}
async function scopeOfPath(path, workspaceRoot, homeRoot) {
  const canonical = await canonicalizeMutationTarget(path);
  if (canonical === null) return "outside";
  if (workspaceRoot !== null && isContained(workspaceRoot, canonical)) {
    return "workspace";
  }
  if (homeRoot !== null && isContained(homeRoot, canonical)) {
    return "home";
  }
  return "outside";
}
async function canonicalizeExisting(path) {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}
async function canonicalizeMutationTarget(path, depth = 0) {
  if (depth > 40) return null;
  try {
    return await realpath(path);
  } catch (err) {
    if (err.code !== "ENOENT") return null;
  }
  const linkTarget = await readlinkIfSymlink(path);
  if (linkTarget !== null) {
    const resolvedTarget = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(path), linkTarget);
    return canonicalizeMutationTarget(resolvedTarget, depth + 1);
  }
  return canonicalizeDeepestExisting(path);
}
async function readlinkIfSymlink(path) {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return null;
    return await readlink(path);
  } catch {
    return null;
  }
}
async function canonicalizeDeepestExisting(path) {
  let current = path;
  let suffix = "";
  for (; ; ) {
    try {
      const resolved = await realpath(current);
      return suffix.length === 0 ? resolved : join(resolved, suffix);
    } catch (err) {
      if (err.code !== "ENOENT") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      suffix = suffix.length === 0 ? basenameOf(current) : join(basenameOf(current), suffix);
      current = parent;
    }
  }
}
function basenameOf(path) {
  return path.slice(dirname(path).length).replace(/^[\\/]+/, "");
}
function isContained(parent, child) {
  const rel = relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}
async function touchesTrustConfig(absolutePaths, trustPaths) {
  if (trustPaths.length === 0) return false;
  const canonicalTrust = await Promise.all(
    trustPaths.map((p) => canonicalizeMutationTarget(p))
  );
  const trustSet = new Set(
    canonicalTrust.filter((p) => p !== null)
  );
  if (trustSet.size === 0) return false;
  for (const path of absolutePaths) {
    const canonical = await canonicalizeMutationTarget(path);
    if (canonical !== null && trustSet.has(canonical)) return true;
  }
  return false;
}
export {
  categorizeFsMutation,
  resolveFsScope
};
