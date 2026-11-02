import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
const NON_INTERACTIVE_ENV = {
  HOMEBREW_NO_AUTO_UPDATE: "1",
  HOMEBREW_NO_ENV_HINTS: "1",
  DEBIAN_FRONTEND: "noninteractive",
  PIP_NO_INPUT: "1",
  npm_config_yes: "true",
  GIT_TERMINAL_PROMPT: "0"
};
const HOME_TOOLCHAIN_DIRS = [
  ".local/bin",
  ".cargo/bin",
  ".bun/bin",
  ".deno/bin",
  "go/bin",
  ".npm-global/bin",
  ".volta/bin",
  ".pyenv/shims",
  ".pyenv/bin",
  ".rbenv/shims",
  ".asdf/shims",
  ".local/share/mise/shims",
  ".linuxbrew/bin"
];
const SYSTEM_TOOLCHAIN_DIRS = {
  darwin: [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin"
  ],
  linux: [
    "/home/linuxbrew/.linuxbrew/bin",
    "/home/linuxbrew/.linuxbrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/snap/bin"
  ]
};
function withToolchainEnv(env, options = {}) {
  const platform = options.platform ?? process.platform;
  const out = { ...env };
  for (const [name, value] of Object.entries(NON_INTERACTIVE_ENV)) {
    if (out[name] === void 0) out[name] = value;
  }
  if (platform === "win32") return out;
  const exists = options.exists ?? existsSync;
  const home = options.home ?? env.HOME ?? homedir();
  const pathKey = "PATH";
  const current = (out[pathKey] ?? "").split(delimiter).filter(Boolean);
  const seen = new Set(current);
  const extra = [];
  const add = (dir, mustExist) => {
    if (dir.length === 0 || seen.has(dir)) return;
    if (mustExist && !exists(dir)) return;
    seen.add(dir);
    extra.push(dir);
  };
  const systemPaths = options.systemPaths ?? (platform === "darwin" ? readEtcPaths() : []);
  for (const dir of systemPaths) if (dir.startsWith("/")) add(dir, true);
  for (const dir of SYSTEM_TOOLCHAIN_DIRS[platform] ?? []) add(dir, true);
  if (home.length > 0) {
    const nvmBin = nvmDefaultBin(env.NVM_DIR ?? join(home, ".nvm"), exists);
    if (nvmBin !== null) add(nvmBin, true);
    for (const rel of HOME_TOOLCHAIN_DIRS) add(join(home, rel), true);
  }
  if (extra.length > 0) out[pathKey] = [...current, ...extra].join(delimiter);
  return out;
}
function nvmDefaultBin(nvmDir, exists = existsSync) {
  const versionsDir = join(nvmDir, "versions", "node");
  if (!exists(versionsDir)) return null;
  let installed;
  try {
    installed = readdirSync(versionsDir).filter((name) => /^v\d+/.test(name));
  } catch {
    return null;
  }
  if (installed.length === 0) return null;
  installed.sort(compareVersionsDesc);
  let alias = "";
  try {
    alias = readFileSync(join(nvmDir, "alias", "default"), "utf8").trim();
  } catch {
  }
  const wanted = alias.replace(/^v/, "");
  const match = /^\d+(\.\d+){0,2}$/.test(wanted) ? installed.find((name) => name === `v${wanted}` || name.startsWith(`v${wanted}.`)) : void 0;
  return join(versionsDir, match ?? installed[0], "bin");
}
function compareVersionsDesc(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
function readEtcPaths() {
  const files = ["/etc/paths"];
  try {
    for (const name of readdirSync("/etc/paths.d").sort()) {
      files.push(join("/etc/paths.d", name));
    }
  } catch {
  }
  const out = [];
  for (const file of files) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const dir = line.trim();
        if (dir.length > 0 && !dir.startsWith("#")) out.push(dir);
      }
    } catch {
    }
  }
  return out;
}
export {
  NON_INTERACTIVE_ENV,
  nvmDefaultBin,
  withToolchainEnv
};
