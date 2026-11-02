import { join } from "node:path";
import { readCoreBackend } from "./core/core-state.mjs";
function resolveBackendDir(dataDir) {
  return join(dataDir, "backend");
}
function resolveModelsDir(dataDir) {
  return join(dataDir, "models");
}
function resolveServerBinPath(dataDir, binaryName, engine) {
  if (engine === "atomic-core") {
    const backend = readCoreBackend(dataDir);
    if (!backend) throw new Error("Atomic Core backend is not installed.");
    return backend.binary;
  }
  return join(resolveBackendDir(dataDir), binaryName);
}
function resolveModelDir(dataDir, modelId) {
  return join(resolveModelsDir(dataDir), modelId);
}
function resolveModelFilePath(dataDir, modelId, filename) {
  return join(resolveModelDir(dataDir, modelId), filename);
}
function resolveChatModelWeightsPath(dataDir, model) {
  return model.localPath ?? resolveModelFilePath(dataDir, model.id, model.filename);
}
function resolveMmprojFilePath(dataDir, modelId, mmprojFilename) {
  return join(resolveModelDir(dataDir, modelId), mmprojFilename);
}
function resolveVersionFilePath(dataDir) {
  return join(resolveBackendDir(dataDir), "backend-version.json");
}
function resolveBackendCheckFilePath(dataDir) {
  return join(dataDir, "llama-backend-check.json");
}
function resolvePidFilePath(dataDir) {
  return join(dataDir, "llama-server.pid");
}
function resolveLogFilePath(dataDir) {
  return join(dataDir, "llama-server.log");
}
function resolveApiKeyFilePath(dataDir) {
  return join(dataDir, "llama-server.key");
}
function resolveThroughputFilePath(dataDir) {
  return join(dataDir, "llama-server.throughput.json");
}
function resolveLaunchFilePath(dataDir) {
  return join(dataDir, "llama-server.launch.json");
}
function resolveEmbeddingPidFilePath(dataDir) {
  return join(dataDir, "llama-embed.pid");
}
function resolveEmbeddingLogFilePath(dataDir) {
  return join(dataDir, "llama-embed.log");
}
export {
  resolveApiKeyFilePath,
  resolveBackendCheckFilePath,
  resolveBackendDir,
  resolveChatModelWeightsPath,
  resolveEmbeddingLogFilePath,
  resolveEmbeddingPidFilePath,
  resolveLaunchFilePath,
  resolveLogFilePath,
  resolveMmprojFilePath,
  resolveModelDir,
  resolveModelFilePath,
  resolveModelsDir,
  resolvePidFilePath,
  resolveServerBinPath,
  resolveThroughputFilePath,
  resolveVersionFilePath
};
