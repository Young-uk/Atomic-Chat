import {
  LINUX_ARM64_MIN_GLIBC,
  UnsupportedGlibcError
} from "./platform-assets.mjs";
import { LINUX_ARM64_MIN_GLIBC as LINUX_ARM64_MIN_GLIBC2 } from "./platform-assets.mjs";
const LINUX_ARM64_BACKEND_ASSET = "llama-turboquant-linux-arm64-cuda-13.3.zip";
function isSupportedGlibc(version) {
  const match = version?.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const min = LINUX_ARM64_MIN_GLIBC;
  return major > min.major || major === min.major && minor >= min.minor;
}
let cachedGlibcVersion;
function detectGlibcVersion() {
  if (cachedGlibcVersion !== void 0) return cachedGlibcVersion;
  const report = process.report?.getReport();
  cachedGlibcVersion = report?.header?.glibcVersionRuntime ?? null;
  return cachedGlibcVersion;
}
function resetGlibcVersionCache() {
  cachedGlibcVersion = void 0;
}
function assertLinuxArm64Glibc(version) {
  if (!isSupportedGlibc(version)) throw new UnsupportedGlibcError(version);
}
function linuxArm64ManagedSupport(glibcVersion = detectGlibcVersion()) {
  return { supported: isSupportedGlibc(glibcVersion), glibcVersion };
}
export {
  LINUX_ARM64_BACKEND_ASSET,
  LINUX_ARM64_MIN_GLIBC2 as LINUX_ARM64_MIN_GLIBC,
  assertLinuxArm64Glibc,
  detectGlibcVersion,
  isSupportedGlibc,
  linuxArm64ManagedSupport,
  resetGlibcVersionCache
};
