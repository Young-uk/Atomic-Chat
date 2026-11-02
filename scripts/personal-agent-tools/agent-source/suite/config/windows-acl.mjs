import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
function defaultDeps() {
  return {
    platform: process.platform,
    username: () => userInfo().username,
    runIcacls: (args) => {
      execFileSync("icacls", args, {
        stdio: "ignore",
        timeout: 5e3,
        windowsHide: true
      });
    },
    probeRead: (path) => {
      readFileSync(path);
    }
  };
}
function restrictWindowsAcl(path, deps = defaultDeps()) {
  if (deps.platform !== "win32") return;
  let username;
  try {
    username = deps.username();
  } catch {
    return;
  }
  if (!username) return;
  try {
    deps.runIcacls([path, "/inheritance:r", "/grant:r", `${username}:F`]);
  } catch {
  }
  try {
    deps.probeRead(path);
    return;
  } catch {
  }
  try {
    deps.runIcacls([path, "/reset"]);
  } catch {
  }
}
export {
  restrictWindowsAcl
};
