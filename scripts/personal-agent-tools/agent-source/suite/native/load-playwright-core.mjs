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
async function loadPlaywrightCore() {
  if (cached) return cached;
  if (isRunningUnderSea()) {
    const anchor = join(dirname(execPath), "__atomic_sea_anchor__.js");
    const req = createRequire(anchor);
    cached = req("playwright-core");
    return cached;
  }
  const mod = await import("playwright-core");
  cached = mod;
  return cached;
}
export {
  loadPlaywrightCore
};
