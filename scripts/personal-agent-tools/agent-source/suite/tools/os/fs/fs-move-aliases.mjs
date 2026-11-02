import { namesFolder } from "./fs-move-plan.mjs";
const SOURCE_ALIASES = ["paths", "sources", "src", "source"];
const DEST_ALIASES = ["destination", "dest", "target"];
const CANONICAL = ["from", "to", "moves"];
function given(value) {
  return value !== void 0 && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function sourceList(value) {
  if (nonEmptyString(value)) {
    const listed = encodedList(value);
    return listed ?? [value];
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(nonEmptyString) ? value : null;
}
function encodedList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(nonEmptyString) ? parsed : null;
  } catch {
    return null;
  }
}
function onlyAlias(args, names) {
  const present = names.filter((name) => Object.hasOwn(args, name));
  return present.length === 1 ? present[0] : null;
}
const LIST_ALIASES = /* @__PURE__ */ new Set(["paths", "sources"]);
function lastSegment(path, platform) {
  return path.split(platform === "win32" ? /[\\/]/ : "/").pop() ?? "";
}
function namesTargetFile(source, dest, platform, isFile) {
  const name = lastSegment(dest, platform);
  if (/.\.[^.]+$/.test(name)) return true;
  if (name === lastSegment(source, platform)) return true;
  return isFile?.(dest) === true;
}
const CANONICAL_HINT = "os.fs.move takes { from, to } or { moves: [{ from, to }] }";
function readMoveAliases(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const sourceKey = onlyAlias(args, SOURCE_ALIASES);
  const destKey = onlyAlias(args, DEST_ALIASES);
  if (sourceKey === null || destKey === null) return null;
  if (CANONICAL.some((key) => given(args[key]))) return null;
  const sources = sourceList(args[sourceKey]);
  const dest = args[destKey];
  if (sources === null || !nonEmptyString(dest)) return null;
  const rest = { ...args };
  delete rest[sourceKey];
  delete rest[destKey];
  for (const key of CANONICAL) delete rest[key];
  const folder = namesFolder(dest, platform) ? dest : `${dest}/`;
  if (sources.length === 1) {
    const intoFolder = LIST_ALIASES.has(sourceKey) && !namesTargetFile(sources[0], dest, platform, options.isFile);
    const to = intoFolder ? folder : dest;
    return {
      args: { ...rest, from: sources[0], to },
      note: intoFolder ? `note: read \`${sourceKey}\` as \`from\` and \`${destKey}\` as the folder \`to\`: \`${folder}\`; ${CANONICAL_HINT}` : `note: read \`${sourceKey}\` as \`from\` and \`${destKey}\` as \`to\`; ${CANONICAL_HINT}`
    };
  }
  return {
    args: { ...rest, moves: sources.map((from) => ({ from, to: folder })) },
    note: `note: read \`${sourceKey}\` (${sources.length} paths) and \`${destKey}\` as moves into \`${folder}\`; ` + CANONICAL_HINT
  };
}
export {
  readMoveAliases
};
