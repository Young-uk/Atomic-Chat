class UnsupportedPlatformError extends Error {
  constructor(platform, arch) {
    super(
      `managed llama.cpp backend is only built for darwin-arm64, linux-x64, linux-arm64, win32-x64, and win32-arm64; got ${platform}-${arch}. Use external mode instead.`
    );
    this.platform = platform;
    this.arch = arch;
    this.name = "UnsupportedPlatformError";
  }
}
const LINUX_ARM64_MIN_GLIBC = { major: 2, minor: 38 };
class UnsupportedGlibcError extends UnsupportedPlatformError {
  constructor(glibcVersion) {
    super("linux", "arm64");
    this.glibcVersion = glibcVersion;
    this.name = "UnsupportedGlibcError";
    this.message = `managed llama.cpp backend for linux-arm64 needs glibc ${LINUX_ARM64_MIN_GLIBC.major}.${LINUX_ARM64_MIN_GLIBC.minor} or newer (Ubuntu 24.04, Debian 13, DGX OS 7); found ${glibcVersion ?? "no glibc"}. Use external mode instead: start llama-server yourself and point the agent at it with localModels.mode = "external".`;
  }
}
const WINDOWS_ARM64_BACKEND_ASSET = "llama-turboquant-windows-arm64-cpu.zip";
const WINDOWS_ARM64_NO_BACKEND_MESSAGE = "Local models are not available yet for Windows on ARM. Use a cloud model instead.";
function isWindowsArm64(platform = process.platform, arch = process.arch) {
  return platform === "win32" && arch === "arm64";
}
function resolvePlatformAsset(platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && arch === "arm64") {
    return {
      platform,
      arch,
      assetName: "llama-turboquant-macos-arm64.zip",
      binaryName: "llama-server"
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      platform,
      arch,
      assetName: "llama-turboquant-linux-x64-vulkan.zip",
      binaryName: "llama-server"
    };
  }
  if (platform === "linux" && arch === "arm64") {
    return {
      platform,
      arch,
      assetName: "llama-turboquant-linux-arm64-cuda-13.3.zip",
      binaryName: "llama-server"
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      platform,
      arch,
      assetName: "llama-turboquant-windows-x64-vulkan.zip",
      binaryName: "llama-server.exe"
    };
  }
  if (platform === "win32" && arch === "arm64") {
    return {
      platform,
      arch,
      assetName: WINDOWS_ARM64_BACKEND_ASSET,
      binaryName: "llama-server.exe"
    };
  }
  throw new UnsupportedPlatformError(String(platform), String(arch));
}
export {
  LINUX_ARM64_MIN_GLIBC,
  UnsupportedGlibcError,
  UnsupportedPlatformError,
  WINDOWS_ARM64_BACKEND_ASSET,
  WINDOWS_ARM64_NO_BACKEND_MESSAGE,
  isWindowsArm64,
  resolvePlatformAsset
};
