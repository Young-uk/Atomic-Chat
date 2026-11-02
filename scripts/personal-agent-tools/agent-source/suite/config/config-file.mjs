import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { carryUnknownConfigKeys } from "./carry-unknown-config-keys.mjs";
import { keepSetAsideLocalModelValues } from "./local-models/keep-set-aside-values.mjs";
import {
  ConfigValidationError,
  ENV_DEFAULTS,
  parseUserConfigFile,
  USER_CONFIG_DEFAULTS,
  USER_CONFIG_VERSION
} from "./config-schema.mjs";
import { writeOwnerOnlyFileAtomicSync } from "./owner-only-file.mjs";
function getUserConfigPath(stateDir) {
  return join(stateDir, ENV_DEFAULTS.USER_CONFIG_FILE_NAME);
}
function getDotenvPath(stateDir) {
  return join(stateDir, ".env");
}
function getTrustConfigPaths(paths) {
  return [paths.userConfigFile, getDotenvPath(paths.stateDir)];
}
function getStateSecretPaths(paths) {
  return [
    ...getTrustConfigPaths(paths),
    join(paths.localModelsDataDir, "llama-server.key"),
    join(paths.localModelsDataDir, "core", "chat.json"),
    join(paths.localModelsDataDir, "core", "embedding.json"),
    join(paths.stateDir, "atomic-mail", "session.json")
  ];
}
function readUserConfigFileSync(path) {
  const raw = readRawUserConfigFileSync(path);
  if (!raw) return null;
  return parseUserConfigFile(raw.parsed);
}
function writeUserConfigFileSync(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const diskTree = readJsonObjectFromFileSync(path);
  const onDisk = readVersionField(diskTree);
  const raised = onDisk !== null && onDisk > data.version;
  const version = raised ? onDisk : data.version;
  if (raised) {
    process.stderr.write(
      `[atomic-agent] kept config version ${onDisk} (this build writes v${data.version}) at ${path}
`
    );
  }
  const carried = diskTree ? carryUnknownConfigKeys(keepSetAsideLocalModelValues(data, diskTree), diskTree) : data;
  const payload = JSON.stringify(
    version === carried.version ? carried : { ...carried, version },
    null,
    2
  ) + "\n";
  writeOwnerOnlyFileAtomicSync(path, payload);
}
import { setConfigNoticeSink } from "./config-primitives.mjs";
import { emitConfigNotice } from "./config-primitives.mjs";
function ensureUserConfigFileSync(path) {
  const raw = readRawUserConfigFileSync(path);
  if (!raw) {
    writeUserConfigFileSync(path, USER_CONFIG_DEFAULTS);
    emitConfigNotice(`[atomic-agent] created default config at ${path}`);
    return USER_CONFIG_DEFAULTS;
  }
  const parsed = withConfigPathInError(
    path,
    () => parseUserConfigFile(raw.parsed)
  );
  if (raw.originalVersion === null || raw.originalVersion < USER_CONFIG_VERSION) {
    writeUserConfigFileSync(path, parsed);
    emitConfigNotice(
      `[atomic-agent] migrated config v${raw.originalVersion} \u2192 v${USER_CONFIG_VERSION} at ${path}`
    );
  }
  return parsed;
}
function userConfigFileSha256Sync(path) {
  return sha256Hex(readUserConfigBytesSync(path) ?? Buffer.alloc(0));
}
function readUserConfigSnapshotSync(path) {
  const bytes = readUserConfigBytesSync(path);
  if (!bytes) {
    return { sha256: sha256Hex(Buffer.alloc(0)), config: USER_CONFIG_DEFAULTS };
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    throw new ConfigValidationError(
      "<file>",
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return {
    sha256: sha256Hex(bytes),
    config: withConfigPathInError(path, () => parseUserConfigFile(parsed))
  };
}
function readUserConfigBytesSync(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ConfigValidationError(
      "<file>",
      `failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function withConfigPathInError(path, read) {
  try {
    return read();
  } catch (err) {
    if (!(err instanceof ConfigValidationError)) throw err;
    throw new ConfigValidationError(
      err.field,
      `${err.reason} (in ${path}) \u2014 edit or delete that file to start from defaults, or point ATOMIC_AGENT_STATE_DIR elsewhere`
    );
  }
}
function readRawUserConfigFileSync(path) {
  if (!existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigValidationError(
      "<file>",
      `failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigValidationError(
      "<file>",
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return { parsed, originalVersion: readVersionField(parsed) };
}
function readUserConfigVersionOnDiskSync(path) {
  return readVersionFieldFromFileSync(path);
}
function readVersionFieldFromFileSync(path) {
  return readVersionField(readJsonObjectFromFileSync(path));
}
function readJsonObjectFromFileSync(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function readVersionField(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const value = parsed.version;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export {
  ensureUserConfigFileSync,
  getDotenvPath,
  getStateSecretPaths,
  getTrustConfigPaths,
  getUserConfigPath,
  readUserConfigFileSync,
  readUserConfigSnapshotSync,
  readUserConfigVersionOnDiskSync,
  setConfigNoticeSink,
  userConfigFileSha256Sync,
  writeUserConfigFileSync
};
