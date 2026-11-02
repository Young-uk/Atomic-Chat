import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { restrictWindowsAcl } from "./windows-acl.mjs";
const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_FILE_MODE = 384;
class DotenvWriterError extends Error {
  constructor(message) {
    super(message);
    this.name = "DotenvWriterError";
  }
}
function setDotenvKey(stateDir, key, value) {
  if (!KEY_PATTERN.test(key)) {
    throw new DotenvWriterError(`invalid key '${key}'`);
  }
  const path = join(stateDir, ".env");
  const existed = existsSync(path);
  const original = existed ? readFileSync(path, "utf8") : "";
  const updated = applyMutation(original, key, value);
  if (updated === null) {
    if (!existed) {
      return { path, preexisting: false, changed: false };
    }
    return { path, preexisting: true, changed: false };
  }
  if (updated === original && existed) {
    return { path, preexisting: true, changed: false };
  }
  if (updated.length === 0) {
    if (existed) unlinkSync(path);
    return { path, preexisting: existed, changed: existed };
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, updated, { encoding: "utf8", mode: SECRET_FILE_MODE });
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw err;
  }
  try {
    chmodSync(path, SECRET_FILE_MODE);
  } catch {
  }
  restrictWindowsAcl(path);
  return { path, preexisting: existed, changed: true };
}
function applyMutation(original, key, value) {
  const lines = original.length === 0 ? [] : original.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let foundIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (matchesKey(lines[i] ?? "", key)) {
      foundIndex = i;
      break;
    }
  }
  if (value === null) {
    if (foundIndex === -1) return null;
    lines.splice(foundIndex, 1);
    return joinWithTrailingNewline(lines);
  }
  const formatted = `${key}=${formatValue(value)}`;
  if (foundIndex === -1) {
    lines.push(formatted);
  } else {
    lines[foundIndex] = formatted;
  }
  return joinWithTrailingNewline(lines);
}
function matchesKey(line, key) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) return false;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return false;
  return trimmed.slice(0, eq).trim() === key;
}
function formatValue(value) {
  if (value.length === 0) return "";
  if (/[\s"'#\\]/.test(value)) {
    if (value.includes('"') && !value.includes("'")) {
      return `'${value}'`;
    }
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}
function joinWithTrailingNewline(lines) {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}
`;
}
export {
  DotenvWriterError,
  setDotenvKey
};
