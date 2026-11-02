import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import {
  assertLinuxArm64Glibc,
  detectGlibcVersion
} from "./linux-arm64-backend-variant.mjs";
import {
  resolvePlatformAsset,
  WINDOWS_ARM64_BACKEND_ASSET
} from "./platform-assets.mjs";
const WINDOWS_BACKEND_ASSETS = {
  vulkan: "llama-turboquant-windows-x64-vulkan.zip",
  cuda124: "llama-turboquant-windows-x64-cuda-12.4.zip",
  cuda133: "llama-turboquant-windows-x64-cuda-13.3.zip",
  cpu: "llama-turboquant-windows-x64-cpu.zip"
};
const BACKEND_VARIANT_PREFERENCES = [
  "auto",
  "cpu",
  "vulkan",
  "cuda-12.4",
  "cuda-13.3"
];
function isBackendVariantPreference(raw) {
  return BACKEND_VARIANT_PREFERENCES.includes(raw);
}
const ASSET_BY_VARIANT_PREFERENCE = {
  cpu: WINDOWS_BACKEND_ASSETS.cpu,
  vulkan: WINDOWS_BACKEND_ASSETS.vulkan,
  "cuda-12.4": WINDOWS_BACKEND_ASSETS.cuda124,
  "cuda-13.3": WINDOWS_BACKEND_ASSETS.cuda133
};
let configuredBackendVariant = "auto";
function setConfiguredBackendVariant(v) {
  configuredBackendVariant = v;
}
function getConfiguredBackendVariant() {
  return configuredBackendVariant;
}
const CORE_BACKEND_VARIANTS = ["auto", "cpu"];
function isCoreBackendVariant(raw) {
  return CORE_BACKEND_VARIANTS.includes(raw);
}
let configuredCoreBackendVariant = "auto";
function setConfiguredCoreBackendVariant(v) {
  configuredCoreBackendVariant = v;
}
function getConfiguredCoreBackendVariant() {
  return configuredCoreBackendVariant;
}
function isWindowsGpuBackendAsset(assetName) {
  if (assetName === WINDOWS_ARM64_BACKEND_ASSET) return false;
  if (assetName === void 0) return true;
  return assetName === WINDOWS_BACKEND_ASSETS.vulkan || assetName === WINDOWS_BACKEND_ASSETS.cuda124 || assetName === WINDOWS_BACKEND_ASSETS.cuda133;
}
function isWindowsCudaBackendAsset(assetName) {
  return assetName === WINDOWS_BACKEND_ASSETS.cuda124 || assetName === WINDOWS_BACKEND_ASSETS.cuda133;
}
function isIncompleteWindowsCudaBackend(dir) {
  let entries;
  try {
    entries = readdirSync(dir).map((e) => e.toLowerCase());
  } catch {
    return false;
  }
  if (!entries.includes("ggml-cuda.dll")) return false;
  return !entries.some((e) => /^cudart64_\d+\.dll$/.test(e));
}
function parseDriverCudaVersion(output) {
  const match = output.match(/CUDA(?:\s+\w+)?\s+Version:\s*(\d+)\.(\d+)/i);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor };
}
function isAtLeast(v, major, minor) {
  return v.major > major || v.major === major && v.minor >= minor;
}
function parseComputeCapabilities(output) {
  let best = null;
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\.(\d+)$/);
    if (!match) continue;
    const cc = { major: Number(match[1]), minor: Number(match[2]) };
    if (best === null || cc.major > best.major || cc.major === best.major && cc.minor > best.minor) {
      best = cc;
    }
  }
  return best;
}
const FIRST_CC_BEYOND_CUDA_12_4 = 10;
function selectWindowsBackendAsset(cuda, computeCapability = null) {
  if (cuda === null) return WINDOWS_BACKEND_ASSETS.vulkan;
  if (!isAtLeast(cuda, 12, 4)) return WINDOWS_BACKEND_ASSETS.vulkan;
  if (computeCapability !== null && computeCapability.major >= FIRST_CC_BEYOND_CUDA_12_4) {
    return WINDOWS_BACKEND_ASSETS.vulkan;
  }
  return WINDOWS_BACKEND_ASSETS.cuda124;
}
function detectDriverCudaVersion() {
  try {
    const out = execSync("nvidia-smi", {
      timeout: 4e3,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString();
    return parseDriverCudaVersion(out);
  } catch {
    return null;
  }
}
function detectGpuComputeCapability() {
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=compute_cap --format=csv,noheader",
      {
        timeout: 4e3,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      }
    ).toString();
    return parseComputeCapabilities(out);
  } catch {
    return null;
  }
}
let cachedWindowsAsset = null;
function detectWindowsBackendAsset() {
  if (configuredBackendVariant !== "auto") {
    return ASSET_BY_VARIANT_PREFERENCE[configuredBackendVariant];
  }
  if (cachedWindowsAsset !== null) return cachedWindowsAsset;
  const cuda = detectDriverCudaVersion();
  const computeCapability = cuda !== null && isAtLeast(cuda, 12, 4) ? detectGpuComputeCapability() : null;
  cachedWindowsAsset = selectWindowsBackendAsset(cuda, computeCapability);
  return cachedWindowsAsset;
}
function resetWindowsBackendAssetCache() {
  cachedWindowsAsset = null;
}
function resolveDownloadAsset(platform = process.platform, arch = process.arch, glibcVersion) {
  const base = resolvePlatformAsset(platform, arch);
  if (base.platform === "linux" && base.arch === "arm64") {
    assertLinuxArm64Glibc(
      glibcVersion === void 0 ? detectGlibcVersion() : glibcVersion
    );
    return base;
  }
  if (base.platform === "win32" && base.arch === "arm64") return base;
  if (base.platform !== "win32") return base;
  return { ...base, assetName: detectWindowsBackendAsset() };
}
export {
  BACKEND_VARIANT_PREFERENCES,
  CORE_BACKEND_VARIANTS,
  WINDOWS_BACKEND_ASSETS,
  detectDriverCudaVersion,
  detectGpuComputeCapability,
  detectWindowsBackendAsset,
  getConfiguredBackendVariant,
  getConfiguredCoreBackendVariant,
  isBackendVariantPreference,
  isCoreBackendVariant,
  isIncompleteWindowsCudaBackend,
  isWindowsCudaBackendAsset,
  isWindowsGpuBackendAsset,
  parseComputeCapabilities,
  parseDriverCudaVersion,
  resetWindowsBackendAssetCache,
  resolveDownloadAsset,
  selectWindowsBackendAsset,
  setConfiguredBackendVariant,
  setConfiguredCoreBackendVariant
};
