import { coreKeyForUrl } from "../core/core-state.mjs";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { restrictWindowsAcl } from "../../config/windows-acl.mjs";
import { resolveApiKeyFilePath } from "../backend-paths.mjs";
const SECRET_FILE_MODE = 384;
const LLAMA_API_KEY_ENV = "LLAMA_API_KEY";
function isUsableKey(key) {
  return key.length > 0 && !/[\s,]/.test(key);
}
function isTransientWindowsError(err) {
  const code = err.code;
  return process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function readKeyFile(dataDir) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const key = readFileSync(resolveApiKeyFilePath(dataDir), "utf-8").trim();
      return { state: "read", key: isUsableKey(key) ? key : null };
    } catch (err) {
      if (err.code === "ENOENT") return { state: "missing" };
      if (!isTransientWindowsError(err) || attempt >= 4) return { state: "unreadable" };
      sleepSync(25);
    }
  }
}
function readManagedApiKey(dataDir) {
  const file = readKeyFile(dataDir);
  return file.state === "read" ? file.key : null;
}
function readWrittenKey(dataDir) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = readManagedApiKey(dataDir);
    if (key) return key;
    if (!existsSync(resolveApiKeyFilePath(dataDir))) return null;
    sleepSync(10);
  }
  return null;
}
function ensureManagedApiKey(dataDir) {
  let file = readKeyFile(dataDir);
  if (file.state === "unreadable") {
    try {
      chmodSync(resolveApiKeyFilePath(dataDir), SECRET_FILE_MODE);
    } catch {
    }
    file = readKeyFile(dataDir);
    if (file.state === "unreadable") return null;
  }
  if (file.state === "read") {
    return file.key ?? readWrittenKey(dataDir) ?? healUnusableKey(dataDir);
  }
  return createKeyFile(dataDir);
}
function createKeyFile(dataDir) {
  const path = resolveApiKeyFilePath(dataDir);
  const key = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    writeFileSync(tmp, `${key}
`, { encoding: "utf-8", mode: SECRET_FILE_MODE });
    try {
      linkSync(tmp, path);
    } catch (err) {
      if (err.code !== "EEXIST") {
        writeFileSync(path, `${key}
`, {
          encoding: "utf-8",
          mode: SECRET_FILE_MODE,
          flag: "wx"
        });
      }
    } finally {
      unlinkQuietly(tmp);
    }
  } catch {
    return readWrittenKey(dataDir);
  }
  try {
    chmodSync(path, SECRET_FILE_MODE);
  } catch {
  }
  restrictWindowsAcl(path);
  return readWrittenKey(dataDir);
}
function unlinkQuietly(path) {
  try {
    unlinkSync(path);
  } catch {
  }
}
const HEAL_WAIT_MS = 3e3;
const LOCK_ABANDONED_MS = 3e4;
const LOCK_UNWRITTEN_MS = 2e3;
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}
function judgeOpenLock(fd) {
  const contents = readFileSync(fd, "utf-8");
  const stat = fstatSync(fd, { bigint: true });
  const age = Date.now() - Number(stat.mtimeMs);
  const pid = Number.parseInt(contents, 10);
  const abandoned = age >= LOCK_ABANDONED_MS || (Number.isInteger(pid) && pid > 0 ? !pidAlive(pid) : age >= LOCK_UNWRITTEN_MS);
  return { abandoned, ino: stat.ino, dev: stat.dev };
}
function withOpenLock(lock, judge) {
  let fd;
  try {
    fd = openSync(lock, "r");
  } catch {
    return false;
  }
  try {
    return judge(fd);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}
function isAbandoned(lock) {
  return withOpenLock(lock, (fd) => judgeOpenLock(fd).abandoned);
}
function unlinkIfAbandoned(lock) {
  withOpenLock(lock, (fd) => {
    const judged = judgeOpenLock(fd);
    if (!judged.abandoned) return false;
    const now = lstatSync(lock, { bigint: true });
    if (now.ino !== judged.ino || now.dev !== judged.dev) return false;
    unlinkSync(lock);
    return true;
  });
}
function newLockToken() {
  return `${process.pid} ${randomBytes(8).toString("hex")}
`;
}
function createExclusive(path, contents) {
  try {
    writeFileSync(path, contents, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch {
    return false;
  }
}
function releaseLock(lock, token) {
  try {
    if (readFileSync(lock, "utf-8") === token) unlinkSync(lock);
  } catch {
  }
}
function breakAbandonedLock(lock) {
  const guard = `${lock}.break`;
  const token = newLockToken();
  if (!createExclusive(guard, token)) {
    unlinkIfAbandoned(guard);
    return;
  }
  try {
    unlinkIfAbandoned(lock);
  } finally {
    releaseLock(guard, token);
  }
}
function tryTakeHealLock(lock) {
  const token = newLockToken();
  if (!createExclusive(lock, token)) {
    if (!isAbandoned(lock)) return null;
    breakAbandonedLock(lock);
    if (!createExclusive(lock, token)) return null;
  }
  unlinkIfAbandoned(`${lock}.break`);
  return token;
}
function renameOverSync(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (!isTransientWindowsError(err) || attempt >= 4) throw err;
      sleepSync(25);
    }
  }
}
function writeTempKey(path) {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, `${randomBytes(32).toString("hex")}
`, {
      encoding: "utf-8",
      mode: SECRET_FILE_MODE,
      flag: "wx"
    });
  } catch {
    return null;
  }
  restrictWindowsAcl(tmp);
  return tmp;
}
function healUnusableKey(dataDir) {
  const path = resolveApiKeyFilePath(dataDir);
  const lock = `${path}.heal-lock`;
  const tmp = writeTempKey(path);
  if (!tmp) return readManagedApiKey(dataDir);
  const deadline = Date.now() + HEAL_WAIT_MS;
  try {
    for (; ; ) {
      const file = readKeyFile(dataDir);
      if (file.state === "unreadable") return null;
      if (file.state === "missing") return createKeyFile(dataDir);
      if (file.key) return file.key;
      const token = tryTakeHealLock(lock);
      if (token) {
        let replaced = false;
        try {
          const held = readKeyFile(dataDir);
          if (held.state === "read" && !held.key) {
            renameOverSync(tmp, path);
            replaced = true;
          }
        } catch {
        } finally {
          releaseLock(lock, token);
        }
        if (replaced) return readManagedApiKey(dataDir);
      }
      if (Date.now() >= deadline) return readManagedApiKey(dataDir);
      sleepSync(25);
    }
  } finally {
    unlinkQuietly(tmp);
  }
}
function resolveManagedServerApiKey(dataDir, configuredKey) {
  return configuredKey || ensureManagedApiKey(dataDir);
}
function buildDaemonEnv(apiKey, base = process.env) {
  return apiKey ? { ...base, [LLAMA_API_KEY_ENV]: apiKey } : { ...base };
}
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
function isLoopbackUrlOnPort(url, ports) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const loopback = LOOPBACK_HOSTS.has(host) || /^127(\.\d{1,3}){3}$/.test(host);
    return loopback && ports.map(String).includes(parsed.port);
  } catch {
    return false;
  }
}
function resolveLocalLlamaApiKey(inputs) {
  const coreKey = coreKeyForUrl(inputs.dataDir, inputs.chatUrl);
  if (coreKey) return coreKey;
  if (inputs.envKey) return inputs.envKey;
  const talksToManagedDaemon = inputs.mode === "managed" || isLoopbackUrlOnPort(inputs.chatUrl, inputs.managedPorts);
  return talksToManagedDaemon ? ensureManagedApiKey(inputs.dataDir) : null;
}
function resolveEmbeddingApiKey(inputs) {
  const coreKey = coreKeyForUrl(inputs.dataDir, inputs.embeddingsUrl);
  if (coreKey) return coreKey;
  if (inputs.configuredKey) return inputs.configuredKey;
  return isLoopbackUrlOnPort(inputs.embeddingsUrl, inputs.managedPorts) ? readManagedApiKey(inputs.dataDir) : null;
}
const OPERATOR_LLAMA_API_KEY_ENV = "ATOMIC_AGENT_LLAMA_API_KEY";
function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, "");
}
function apiKeyForUrl(url, config, env = process.env) {
  const coreKey = config.paths?.localModelsDataDir ? coreKeyForUrl(config.paths.localModelsDataDir, url) : null;
  if (coreKey) return coreKey;
  const envKey = env[OPERATOR_LLAMA_API_KEY_ENV];
  if (envKey) return envKey;
  if (stripTrailingSlashes(url) === stripTrailingSlashes(config.localModels.url)) {
    return config.localModels.apiKey;
  }
  const managedPorts = [
    config.localModels.managed?.port,
    config.localModels.embeddings?.port
  ].filter((port) => typeof port === "number");
  if (!isLoopbackUrlOnPort(url, managedPorts)) return null;
  if (config.localModels.apiKey) return config.localModels.apiKey;
  const dataDir = config.paths?.localModelsDataDir;
  return dataDir ? readManagedApiKey(dataDir) : null;
}
export {
  LLAMA_API_KEY_ENV,
  OPERATOR_LLAMA_API_KEY_ENV,
  apiKeyForUrl,
  buildDaemonEnv,
  ensureManagedApiKey,
  isLoopbackUrlOnPort,
  readManagedApiKey,
  resolveEmbeddingApiKey,
  resolveLocalLlamaApiKey,
  resolveManagedServerApiKey
};
