import { stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { isInside } from "../../../approval/fanout-scope.mjs";
const WORKING_DEPTH = 3;
const NAMED_DEPTH = 2;
const PROTECTED_DEPTH = 3;
function protectedFolders(input) {
  const { home } = input;
  const searchable = ["Desktop", "Documents", "Downloads"].map((n) => join(home, n));
  const guarded = ["Pictures", "Movies", "Music"].map((n) => join(home, n));
  if ((input.platform ?? process.platform) === "win32") {
    const oneDrives = [join(home, "OneDrive"), input.oneDrive].filter(
      (dir) => typeof dir === "string" && dir.length > 0
    );
    for (const oneDrive of new Set(oneDrives)) {
      searchable.push(join(oneDrive, "Desktop"), join(oneDrive, "Documents"));
    }
  }
  return { searchable, guarded };
}
async function candidateRoots(input) {
  const exists = input.exists ?? pathExists;
  const missing = resolve(input.missing);
  const home = resolve(input.home);
  const named = (input.readRoots ?? []).map((root) => resolve(root));
  const anchors = [missing, resolve(input.workingDir), ...named];
  const qualifies = (folder) => anchors.some((anchor) => isInside(folder, anchor));
  const { searchable, guarded } = protectedFolders(input);
  const blocked = [...searchable, ...guarded].filter((dir) => !qualifies(dir));
  const roots = [
    { dir: resolve(input.workingDir), depth: WORKING_DEPTH },
    ...named.map((dir) => ({ dir, depth: NAMED_DEPTH }))
  ];
  const ancestor = await nearestExisting(dirname(missing), exists);
  if (ancestor !== null) {
    const parent = dirname(ancestor);
    roots.push(
      { dir: ancestor, depth: 2 },
      { dir: parent, depth: 1 },
      { dir: dirname(parent), depth: 1 }
    );
  }
  roots.push(
    ...searchable.filter((dir) => qualifies(dir)).map((dir) => ({ dir, depth: PROTECTED_DEPTH }))
  );
  return {
    roots: roots.filter(({ dir }) => dir !== home && !isFilesystemRoot(dir)),
    blocked
  };
}
async function nearestExisting(start, exists) {
  let current = start;
  for (let i = 0; i < 64; i++) {
    if (await exists(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
function isFilesystemRoot(dir) {
  return parse(dir).root === dir;
}
async function pathExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
export {
  candidateRoots
};
