import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function orderForChannel(channel) {
  if (channel === "msedge") {
    return ["edge", "chrome", "brave", "chromium", "canary"];
  }
  if (channel === "chromium") {
    return ["chromium", "chrome", "edge", "brave", "canary"];
  }
  return ["chrome", "edge", "brave", "chromium", "canary"];
}
function exists(candidate) {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}
function findFirst(candidates, order) {
  for (const kind of order) {
    for (const candidate of candidates) {
      if (candidate.kind === kind && exists(candidate.path)) {
        return candidate;
      }
    }
  }
  for (const candidate of candidates) {
    if (exists(candidate.path)) {
      return candidate;
    }
  }
  return null;
}
function macCandidates() {
  const home = os.homedir();
  return [
    {
      kind: "chrome",
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    },
    {
      kind: "chrome",
      path: path.join(
        home,
        "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      )
    },
    {
      kind: "canary",
      path: "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    },
    {
      kind: "canary",
      path: path.join(
        home,
        "Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
      )
    },
    {
      kind: "edge",
      path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    },
    {
      kind: "edge",
      path: path.join(
        home,
        "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      )
    },
    {
      kind: "brave",
      path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    },
    {
      kind: "brave",
      path: path.join(
        home,
        "Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
      )
    },
    {
      kind: "chromium",
      path: "/Applications/Chromium.app/Contents/MacOS/Chromium"
    },
    {
      kind: "chromium",
      path: path.join(
        home,
        "Applications/Chromium.app/Contents/MacOS/Chromium"
      )
    }
  ];
}
function linuxCandidates() {
  return [
    { kind: "chrome", path: "/usr/bin/google-chrome" },
    { kind: "chrome", path: "/usr/bin/google-chrome-stable" },
    { kind: "chrome", path: "/opt/google/chrome/google-chrome" },
    { kind: "edge", path: "/usr/bin/microsoft-edge" },
    { kind: "edge", path: "/usr/bin/microsoft-edge-stable" },
    { kind: "brave", path: "/usr/bin/brave-browser" },
    { kind: "brave", path: "/usr/bin/brave-browser-stable" },
    { kind: "brave", path: "/snap/bin/brave" },
    { kind: "chromium", path: "/usr/bin/chromium" },
    { kind: "chromium", path: "/usr/bin/chromium-browser" },
    { kind: "chromium", path: "/snap/bin/chromium" }
  ];
}
function windowsCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const join = path.win32.join;
  const candidates = [];
  if (localAppData) {
    candidates.push(
      {
        kind: "chrome",
        path: join(
          localAppData,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        )
      },
      {
        kind: "canary",
        path: join(
          localAppData,
          "Google",
          "Chrome SxS",
          "Application",
          "chrome.exe"
        )
      },
      {
        kind: "edge",
        path: join(
          localAppData,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe"
        )
      },
      {
        kind: "brave",
        path: join(
          localAppData,
          "BraveSoftware",
          "Brave-Browser",
          "Application",
          "brave.exe"
        )
      }
    );
  }
  candidates.push(
    {
      kind: "chrome",
      path: join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
    },
    {
      kind: "chrome",
      path: join(
        programFilesX86,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe"
      )
    },
    {
      kind: "edge",
      path: join(
        programFiles,
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe"
      )
    },
    {
      kind: "edge",
      path: join(
        programFilesX86,
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe"
      )
    },
    {
      kind: "brave",
      path: join(
        programFiles,
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe"
      )
    }
  );
  return candidates;
}
function candidatesForPlatform(platform) {
  if (platform === "darwin") return macCandidates();
  if (platform === "linux") return linuxCandidates();
  if (platform === "win32") return windowsCandidates();
  return [];
}
function findChromeExecutable(opts) {
  if (opts.executablePath) {
    if (!exists(opts.executablePath)) {
      throw new Error(`browser executable not found: ${opts.executablePath}`);
    }
    return { kind: "custom", path: opts.executablePath };
  }
  const platform = opts.platform ?? process.platform;
  const candidates = candidatesForPlatform(platform);
  return findFirst(candidates, orderForChannel(opts.channel));
}
export {
  findChromeExecutable
};
