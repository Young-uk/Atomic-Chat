import { configBranchKind, knownConfigKeys } from "./config-shape.mjs";
const UNSAFE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function carryUnknownConfigKeys(data, disk) {
  return carryInto(
    "",
    data,
    disk
  );
}
function carryInto(path, data, disk) {
  const known = knownConfigKeys(path);
  const carried = {};
  let changed = false;
  for (const [key, value] of Object.entries(disk)) {
    if (UNSAFE_KEYS.has(key) || known.has(key) || Object.hasOwn(data, key)) {
      continue;
    }
    carried[key] = value;
    changed = true;
  }
  for (const key of known) {
    const childPath = path === "" ? key : `${path}.${key}`;
    if (configBranchKind(childPath) !== "fixed") continue;
    const child = Object.hasOwn(data, key) ? data[key] : void 0;
    const childOnDisk = Object.hasOwn(disk, key) ? disk[key] : void 0;
    if (!isPlainObject(child) || !isPlainObject(childOnDisk)) continue;
    const merged = carryInto(childPath, child, childOnDisk);
    if (merged === child) continue;
    carried[key] = merged;
    changed = true;
  }
  return changed ? { ...data, ...carried } : data;
}
export {
  carryUnknownConfigKeys
};
