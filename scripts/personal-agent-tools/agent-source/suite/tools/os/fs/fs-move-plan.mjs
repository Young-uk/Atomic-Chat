import * as fsPromises from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveUserPath } from "../expand-home.mjs";
const NODE_MOVE_FS = fsPromises;
function namesFolder(rawTo, platform = process.platform) {
  return rawTo.endsWith("/") || platform === "win32" && rawTo.endsWith("\\");
}
function isStrictlyInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
function fail(message) {
  throw new Error(`os.fs.move: ${message}`);
}
async function lstatOrNull(fs, path) {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}
async function realpathOrNull(fs, path) {
  try {
    return await fs.realpath(path);
  } catch {
    return null;
  }
}
async function canonicalLanding(fs, path) {
  let current = path;
  const suffix = [];
  for (; ; ) {
    const real = await realpathOrNull(fs, current);
    if (real !== null) return join(real, ...suffix.reverse());
    const parent = dirname(current);
    if (parent === current) return path;
    suffix.push(basename(current));
    current = parent;
  }
}
async function sameEntry(fs, a, b, platform = process.platform) {
  if (a === b) return true;
  if (platform !== "win32" && platform !== "darwin") return false;
  if (a.toLowerCase() !== b.toLowerCase()) return false;
  try {
    const [sa, sb] = await Promise.all([
      fs.lstat(a, { bigint: true }),
      fs.lstat(b, { bigint: true })
    ]);
    if (sa.ino === 0n && sb.ino === 0n) return true;
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}
async function planOne(item, options) {
  const { fs, workingDir, overwrite } = options;
  const platform = options.platform ?? process.platform;
  const source = resolve(resolveUserPath(item.from, workingDir));
  const sourceInfo = await lstatOrNull(fs, source);
  if (sourceInfo === null) fail(`nothing at \`${item.from}\` (${source})`);
  const folder = sourceInfo.isDirectory();
  const target = resolve(resolveUserPath(item.to, workingDir));
  let dest = target;
  if (namesFolder(item.to, options.platform)) {
    dest = join(target, basename(source));
  } else {
    const targetInfo = await lstatOrNull(fs, target);
    if (targetInfo?.isDirectory() && !await sameEntry(fs, source, target, platform)) {
      dest = join(target, basename(source));
    }
  }
  if (dest === source) {
    fail(`\`${item.from}\` is already at \`${item.to}\` \u2014 nothing to move`);
  }
  let replaces = false;
  const destInfo = await lstatOrNull(fs, dest);
  if (destInfo !== null && !await sameEntry(fs, source, dest, platform)) {
    if (!destInfo.isFile()) {
      fail(`\`${dest}\` already exists and is not a file; it is never replaced \u2014 pick another name or os.fs.trash it first`);
    }
    if (folder) fail(`will not replace the file \`${dest}\` with the folder \`${item.from}\``);
    if (!overwrite) {
      fail(`\`${dest}\` already exists \u2014 pass overwrite: true only if the user wants it replaced, or pick another name`);
    }
    replaces = true;
  }
  if (folder) {
    const realSource = await realpathOrNull(fs, source) ?? source;
    const landing = await canonicalLanding(fs, dest);
    if (isStrictlyInside(source, dest) || isStrictlyInside(realSource, landing)) {
      fail(`cannot move the folder \`${item.from}\` into itself (\`${dest}\`)`);
    }
  }
  return { from: item.from, to: item.to, source, dest, folder, replaces };
}
function collisionKey(path, platform) {
  return platform === "win32" || platform === "darwin" ? path.toLowerCase() : path;
}
function checkBatch(moves, platform) {
  const dests = /* @__PURE__ */ new Map();
  for (const move of moves) {
    const key2 = collisionKey(move.dest, platform);
    const earlier = dests.get(key2);
    if (earlier !== void 0) {
      fail(`\`${earlier.from}\` and \`${move.from}\` would both land at \`${move.dest}\` \u2014 end \`to\` with / to move an item INTO a folder`);
    }
    dests.set(key2, move);
  }
  if (moves.length < 2) return;
  const key = (path) => collisionKey(path, platform);
  for (const a of moves) {
    for (const b of moves) {
      if (a === b) continue;
      if (key(a.source) === key(b.source)) {
        fail(`\`${a.from}\` is listed twice`);
      }
      if (a.folder && isStrictlyInside(key(a.source), key(b.source))) {
        fail(`\`${b.from}\` is inside \`${a.from}\`, which this call also moves \u2014 move the folder or its contents, not both`);
      }
      if (a.folder && isStrictlyInside(key(a.source), key(b.dest))) {
        fail(`\`${b.to}\` is inside \`${a.from}\`, which this call moves away \u2014 split this into two calls`);
      }
      if (key(a.source) === key(b.dest)) {
        fail(`\`${a.from}\` is both moved and moved onto \u2014 split this into two calls`);
      }
      if (isStrictlyInside(key(a.dest), key(b.dest))) {
        fail(`\`${a.to}\` is both a destination and a folder another item lands in \u2014 end \`to\` with / to move an item INTO a folder`);
      }
    }
  }
}
async function planMoves(items, options) {
  const moves = [];
  for (const item of items) moves.push(await planOne(item, options));
  checkBatch(moves, options.platform ?? process.platform);
  return moves;
}
export {
  NODE_MOVE_FS,
  isStrictlyInside,
  namesFolder,
  planMoves,
  sameEntry
};
