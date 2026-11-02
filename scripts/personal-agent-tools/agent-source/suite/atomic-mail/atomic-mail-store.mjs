import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { restrictWindowsAcl } from "../config/windows-acl.mjs";
import {
  ensureUserConfigFileSync,
  getConfig,
  parseUserConfigFile,
  resetConfigCache,
  setDotenvKey,
  writeUserConfigFileSync
} from "../config/index.mjs";
const ATOMIC_MAIL_API_KEY_KEY = "ATOMIC_MAIL_API_KEY";
function readAtomicMailApiKey(env = process.env) {
  const raw = env[ATOMIC_MAIL_API_KEY_KEY];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function writeAtomicMailApiKey(stateDir, apiKey) {
  setDotenvKey(stateDir, ATOMIC_MAIL_API_KEY_KEY, apiKey);
  if (apiKey === null) delete process.env[ATOMIC_MAIL_API_KEY_KEY];
  else process.env[ATOMIC_MAIL_API_KEY_KEY] = apiKey;
}
function resolveSessionPath(stateDir) {
  return join(stateDir, "atomic-mail", "session.json");
}
function readCachedSession(stateDir) {
  try {
    const raw = JSON.parse(
      readFileSync(resolveSessionPath(stateDir), "utf-8")
    );
    if (typeof raw.sessionJwt !== "string" || typeof raw.sessionExpiresAt !== "number")
      return null;
    return {
      sessionJwt: raw.sessionJwt,
      sessionExpiresAt: raw.sessionExpiresAt
    };
  } catch {
    return null;
  }
}
function writeCachedSession(stateDir, session) {
  const path = resolveSessionPath(stateDir);
  if (session === null) {
    try {
      rmSync(path, { force: true });
    } catch {
    }
    return;
  }
  mkdirSync(join(stateDir, "atomic-mail"), { recursive: true, mode: 448 });
  writeFileSync(path, JSON.stringify(session), {
    encoding: "utf-8",
    mode: 384
  });
  try {
    chmodSync(path, 384);
  } catch {
  }
  if (process.platform === "win32") restrictWindowsAcl(path);
}
function persistAtomicMailConfig(patch) {
  const path = getConfig().paths.userConfigFile;
  const prev = ensureUserConfigFileSync(path);
  const draft = { ...prev, atomicMail: { ...prev.atomicMail, ...patch } };
  writeUserConfigFileSync(path, parseUserConfigFile(draft));
  resetConfigCache();
}
export {
  ATOMIC_MAIL_API_KEY_KEY,
  persistAtomicMailConfig,
  readAtomicMailApiKey,
  readCachedSession,
  resolveSessionPath,
  writeAtomicMailApiKey,
  writeCachedSession
};
