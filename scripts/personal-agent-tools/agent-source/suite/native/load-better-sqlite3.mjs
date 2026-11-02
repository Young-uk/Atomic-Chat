import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execPath } from "node:process";
const bootRequire = createRequire(import.meta.url);
function isRunningUnderSea() {
  try {
    const sea = bootRequire("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}
let cached = null;
function resolveCtor() {
  if (cached) return cached;
  let req;
  if (isRunningUnderSea()) {
    const anchor = join(dirname(execPath), "__atomic_sea_anchor__.js");
    req = createRequire(anchor);
  } else {
    req = createRequire(import.meta.url);
  }
  cached = req("better-sqlite3");
  return cached;
}
const DatabaseProxy = new Proxy(function() {
}, {
  apply(_target, _thisArg, args) {
    return new (resolveCtor())(...args);
  },
  construct(_target, args) {
    return new (resolveCtor())(...args);
  },
  get(_target, prop, receiver) {
    return Reflect.get(resolveCtor(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(resolveCtor(), prop);
  }
});
const Database = DatabaseProxy;
export {
  Database
};
