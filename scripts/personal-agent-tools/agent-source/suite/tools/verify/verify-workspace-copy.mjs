import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  chmod
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const VERIFY_COPY_EXCLUDED = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".venv"
]);
const VERIFY_COPY_MAX_BYTES = 2 * 1024 * 1024 * 1024;
function cloneWithCp(src, dest) {
  return new Promise((resolve) => {
    const child = spawn("cp", ["-c", "-R", src, dest], {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
async function measureTree(root, limit) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!VERIFY_COPY_EXCLUDED.has(entry.name)) stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        total += (await lstat(join(dir, entry.name))).size;
      } catch {
      }
      if (total > limit) return total;
    }
  }
  return total;
}
async function copyTreeWithExclusions(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      await symlink(await readlink(from), to);
    } else if (entry.isDirectory()) {
      if (VERIFY_COPY_EXCLUDED.has(entry.name)) {
        await symlink(from, to, "dir");
      } else {
        await copyTreeWithExclusions(from, to);
      }
    } else if (entry.isFile()) {
      await copyFile(from, to);
      const mode = (await lstat(from)).mode & 511;
      if (mode & 73) await chmod(to, mode);
    }
  }
}
async function createVerifyWorkspace(workingDir, options = {}) {
  const platform = options.platform ?? process.platform;
  const dest = join(
    options.tmpRoot ?? tmpdir(),
    `atag-verify-${randomBytes(4).toString("hex")}`
  );
  const cleanup = async () => {
    await rm(dest, { recursive: true, force: true });
  };
  if (platform === "darwin") {
    const cloned = await (options.clone ?? cloneWithCp)(workingDir, dest);
    if (cloned) return { dir: dest, isolated: true, method: "clonefile", cleanup };
    await cleanup();
  }
  const limit = options.maxBytes ?? VERIFY_COPY_MAX_BYTES;
  if (await measureTree(workingDir, limit) > limit) {
    return { dir: workingDir, isolated: false, method: "in-place", cleanup: async () => {
    } };
  }
  try {
    await copyTreeWithExclusions(workingDir, dest);
  } catch {
    await cleanup();
    return { dir: workingDir, isolated: false, method: "in-place", cleanup: async () => {
    } };
  }
  return { dir: dest, isolated: true, method: "copy", cleanup };
}
export {
  VERIFY_COPY_EXCLUDED,
  VERIFY_COPY_MAX_BYTES,
  copyTreeWithExclusions,
  createVerifyWorkspace,
  measureTree
};
