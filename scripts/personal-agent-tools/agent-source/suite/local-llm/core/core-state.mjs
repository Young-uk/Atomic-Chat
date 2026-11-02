import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { restrictWindowsAcl } from "../../config/windows-acl.mjs";
const CORE_VERSIONS = ["0.11.2", "0.13.6", "0.16.0", "0.18.6"];
const CORE_VERSION = CORE_VERSIONS[CORE_VERSIONS.length - 1];
const CORE_PROTOCOL = 2;
const CORE_REPO = "AtomicBot-ai/atomic-chat-core";
import { CORE_RETRY_HINT, CoreUnavailableError } from "./core-errors.mjs";
function coreRoot(dataDir) {
  return resolve(dataDir, "core");
}
function coreVersionDir(dataDir, version) {
  if (!CORE_VERSIONS.includes(version)) {
    throw new Error(`Atomic Core ${version} is not supported by this Agent build. Update Agent first.`);
  }
  return join(coreRoot(dataDir), "versions", version);
}
function coreDataDir(dataDir, version) {
  return join(coreVersionDir(dataDir, version), "data");
}
function coreBinary(dataDir, version) {
  return join(coreVersionDir(dataDir, version), process.platform === "win32" ? "atomic-chat-core.exe" : "atomic-chat-core");
}
function readCoreJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function writeCoreJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value) + "\n", { mode: 384 });
  restrictWindowsAcl(tmp);
  renameSync(tmp, path);
}
function activeCoreVersion(dataDir) {
  const stored = readCoreJson(join(coreRoot(dataDir), "active.json"))?.version;
  return stored && CORE_VERSIONS.includes(stored) ? stored : CORE_VERSION;
}
function readCoreBackend(dataDir, version = activeCoreVersion(dataDir)) {
  const record = readCoreJson(join(coreVersionDir(dataDir, version), "backend.json"));
  return record?.coreVersion === version && typeof record.binary === "string" && existsSync(record.binary) ? record : null;
}
function coreEmbeddingRecordPath(dataDir) {
  return join(coreRoot(dataDir), "embedding-module.json");
}
function readCoreEmbeddingRecord(dataDir) {
  const record = readCoreJson(coreEmbeddingRecordPath(dataDir));
  if (!record || typeof record.modelId !== "string" || typeof record.modelPath !== "string") return null;
  return CORE_VERSIONS.includes(record.coreVersion) ? record : null;
}
function coreSessionPath(dataDir, role) {
  return join(coreRoot(dataDir), `${role}.json`);
}
function readSessionRecord(dataDir, role) {
  const record = readCoreJson(coreSessionPath(dataDir, role));
  if (!record || !Number.isInteger(record.pid) || record.pid <= 0 || !Number.isInteger(record.port) || record.port <= 0 || record.port > 65535 || typeof record.api_key !== "string" || !record.api_key) return null;
  if (!CORE_VERSIONS.includes(record.coreVersion)) return null;
  return record;
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function liveCoreOwner(dataDir, version) {
  const lock = readCoreJson(join(coreDataDir(dataDir, version), "atomic-core", "instance.lock"));
  if (lock?.state !== "ready" || typeof lock.instance_id !== "string" || !Number.isInteger(lock.pid) || lock.pid < 1) return null;
  return pidAlive(lock.pid) ? { instanceId: lock.instance_id } : null;
}
function readCoreSession(dataDir, role) {
  const record = readSessionRecord(dataDir, role);
  if (!record) return null;
  if (liveCoreOwner(dataDir, record.coreVersion)?.instanceId !== record.instanceId) return null;
  return pidAlive(record.pid) ? record : null;
}
function orphanedCoreSession(dataDir, role) {
  const record = readSessionRecord(dataDir, role);
  if (!record || liveCoreOwner(dataDir, record.coreVersion)) return null;
  return pidAlive(record.pid) ? record : null;
}
function coreLoopbackPort(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return null;
  return parsed.port;
}
function coreKeyForUrl(dataDir, url) {
  const port = coreLoopbackPort(url);
  if (port === null) return null;
  for (const role of ["chat", "embedding"]) {
    const record = readCoreSession(dataDir, role) ?? orphanedCoreSession(dataDir, role);
    if (record && String(record.port) === port) return record.api_key;
  }
  return null;
}
export {
  CORE_PROTOCOL,
  CORE_REPO,
  CORE_RETRY_HINT,
  CORE_VERSION,
  CORE_VERSIONS,
  CoreUnavailableError,
  activeCoreVersion,
  coreBinary,
  coreDataDir,
  coreEmbeddingRecordPath,
  coreKeyForUrl,
  coreLoopbackPort,
  coreRoot,
  coreSessionPath,
  coreVersionDir,
  orphanedCoreSession,
  readCoreBackend,
  readCoreEmbeddingRecord,
  readCoreJson,
  readCoreSession,
  writeCoreJson
};
