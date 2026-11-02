import { spawn } from "node:child_process";
const TASKKILL_NOT_FOUND = 128;
function killProcessTree(child, options = {}) {
  const force = options.force ?? false;
  const platform = options.platform ?? process.platform;
  const signal = force ? "SIGKILL" : "SIGTERM";
  const report = options.onTreeKilled ?? (() => {
  });
  if (platform === "win32") {
    if (typeof child.pid === "number") {
      runTaskkill(child, child.pid, {
        force,
        spawnImpl: options.spawnImpl ?? spawn,
        report,
        mayEscalate: !force
      });
      return;
    }
    killDirect(child, signal);
    report(false);
    return;
  }
  killDirect(child, signal);
  report(true);
}
function runTaskkill(child, pid, run) {
  const args = ["/PID", String(pid), "/T", ...run.force ? ["/F"] : []];
  const signal = run.force ? "SIGKILL" : "SIGTERM";
  let taskkill;
  try {
    taskkill = run.spawnImpl("taskkill", args, {
      stdio: "ignore",
      windowsHide: true
    });
  } catch {
    killDirect(child, signal);
    run.report(false);
    return;
  }
  let settled = false;
  taskkill.on("error", () => {
    if (settled) return;
    settled = true;
    killDirect(child, signal);
    run.report(false);
  });
  taskkill.on("close", (code) => {
    if (settled) return;
    settled = true;
    if (code === 0 || code === TASKKILL_NOT_FOUND) {
      run.report(true);
      return;
    }
    if (run.mayEscalate) {
      runTaskkill(child, pid, { ...run, force: true, mayEscalate: false });
      return;
    }
    killDirect(child, "SIGKILL");
    run.report(false);
  });
}
function killDirect(child, signal) {
  try {
    child.kill(signal);
  } catch {
  }
}
export {
  killProcessTree
};
