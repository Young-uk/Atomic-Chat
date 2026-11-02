import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { restrictWindowsAcl } from "./windows-acl.mjs";
const OWNER_ONLY_FILE_MODE = 384;
function writeOwnerOnlyFileAtomicSync(path, payload, restrictAcl = restrictWindowsAcl) {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    unlinkSync(tmp);
  } catch {
  }
  writeFileSync(tmp, payload, {
    encoding: "utf8",
    mode: OWNER_ONLY_FILE_MODE,
    flag: "wx"
  });
  try {
    restrictAcl(tmp);
  } catch {
  }
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
    chmodSync(path, OWNER_ONLY_FILE_MODE);
  } catch {
  }
}
export {
  OWNER_ONLY_FILE_MODE,
  writeOwnerOnlyFileAtomicSync
};
