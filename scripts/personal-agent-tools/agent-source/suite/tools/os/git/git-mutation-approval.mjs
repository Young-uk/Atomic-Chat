import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import {
  requireFsApproval
} from "../fs/fs-require-approval.mjs";
async function requireGitMutationApproval(options, request, signal) {
  const trustPaths = request.trustConfigPaths ?? [];
  const trustInsideRepo = await trustConfigPathsInside(
    request.repoRoot,
    trustPaths
  );
  const outcome = await requireFsApproval(
    options,
    {
      kind: "write",
      paths: [request.repoRoot, ...trustInsideRepo],
      sessionId: request.sessionId,
      tool: request.tool,
      reason: request.reason,
      preview: request.preview,
      affectedResources: [request.repoRoot],
      workingDir: request.workingDir,
      trustConfigPaths: trustPaths
    },
    signal
  );
  return outcome.category;
}
function formatGitCommandLine(args) {
  return ["git", ...args.map(quoteShellArg)].join(" ");
}
function quoteShellArg(arg) {
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./~-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
async function trustConfigPathsInside(repoRoot, trustPaths) {
  if (trustPaths.length === 0) return [];
  const root = await canonicalizePath(repoRoot);
  const inside = [];
  for (const path of trustPaths) {
    const canonical = await canonicalizePath(path);
    if (isContained(root, canonical)) inside.push(path);
  }
  return inside;
}
async function canonicalizePath(path) {
  try {
    return await realpath(path);
  } catch {
  }
  const parent = dirname(path);
  if (parent === path) return path;
  return join(await canonicalizePath(parent), basename(path));
}
function isContained(parent, child) {
  const rel = relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}
export {
  formatGitCommandLine,
  requireGitMutationApproval
};
