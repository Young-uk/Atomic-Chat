const BLOCKED_BUNDLE_IDS = [
  // Atomic Agent itself.
  "io.atomicagent.desktop",
  // Permissions, credentials, the login and security prompts.
  "com.apple.systempreferences",
  "com.apple.Settings",
  "com.apple.keychainaccess",
  "com.apple.SecurityAgent",
  "com.apple.loginwindow",
  "com.apple.Passwords",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  // Apps that run scripts which post input themselves, and launchers that run commands typed into them.
  "com.apple.ScriptEditor2",
  "com.apple.Automator",
  "com.apple.shortcuts",
  "org.hammerspoon.Hammerspoon",
  "com.stairways.keyboardmaestro",
  // .editor, .engine
  "com.runningwithcrayons.Alfred",
  "com.runningwithcrayons.Alfred-Preferences",
  "com.raycast.macos",
  "at.obdev.LaunchBar"
];
const BROWSER_BUNDLE_IDS = [
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.dev",
  "com.google.Chrome.canary",
  "org.chromium.Chromium",
  "company.thebrowser.Browser",
  // Arc
  "company.thebrowser.dia",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.Beta",
  "com.microsoft.edgemac.Dev",
  "com.microsoft.edgemac.Canary",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "org.mozilla.nightly",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "com.operasoftware.Opera",
  "com.operasoftware.OperaGX",
  "com.operasoftware.OperaAir",
  "com.vivaldi.Vivaldi",
  "com.kagi.kagimacOS",
  // Orion
  "com.duckduckgo.macos.browser",
  "app.zen-browser.zen",
  "org.torproject.torbrowser",
  "ru.yandex.desktop.yandex-browser",
  "com.naver.Whale",
  "net.waterfox.waterfox",
  "net.mullvad.mullvadbrowser",
  "io.gitlab.librewolf-community",
  "one.ablaze.floorp",
  "com.sigmaos.sigmaos.macos",
  "net.imput.helium",
  "ai.perplexity.comet",
  "com.openai.atlas"
];
const TERMINAL_BUNDLE_IDS = [
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "dev.warp.Warp",
  "dev.warp.Warp-Preview",
  "org.tabby",
  "com.raphaelamorim.rio",
  "dev.commandline.waveterm",
  "com.termius-dmg.mac",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "org.alacritty",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.vscodium",
  "com.todesktop.230313mzl4w4u92",
  // Cursor
  "com.exafunction.windsurf",
  "dev.zed.Zed",
  "dev.zed.Zed-Preview",
  "com.jetbrains",
  // every JetBrains IDE: com.jetbrains.intellij, .pycharm, .WebStorm, …
  "com.google.android.studio",
  "com.apple.dt.Xcode",
  "com.sublimetext.3",
  "com.sublimetext.4",
  "com.panic.Nova",
  "org.vim.MacVim",
  "org.gnu.Emacs",
  "com.barebones.bbedit",
  "com.macromates.TextMate",
  "com.rstudio.desktop",
  "dev.kiro.desktop",
  "com.google.antigravity"
];
const TERM_PROGRAM_BUNDLES = {
  Apple_Terminal: "com.apple.Terminal",
  "iTerm.app": "com.googlecode.iterm2",
  vscode: "com.microsoft.VSCode",
  WarpTerminal: "dev.warp.Warp-Stable",
  ghostty: "com.mitchellh.ghostty",
  WezTerm: "com.github.wez.wezterm"
};
function hostBundleIds(env) {
  const ids = [];
  const bundle = env.__CFBundleIdentifier;
  if (bundle) ids.push(bundle);
  const term = env.TERM_PROGRAM ? TERM_PROGRAM_BUNDLES[env.TERM_PROGRAM] : void 0;
  if (term) ids.push(term);
  return ids;
}
function matches(list, lower) {
  return list.some((id) => {
    const entry = id.toLowerCase();
    return lower === entry || lower.startsWith(`${entry}.`);
  });
}
function screenAppClass(bundleId, env) {
  if (!bundleId) return null;
  const lower = bundleId.toLowerCase();
  if (matches(BLOCKED_BUNDLE_IDS, lower) || hostBundleIds(env).some((id) => id.toLowerCase() === lower)) return "blocked";
  if (matches(BROWSER_BUNDLE_IDS, lower)) return "browser";
  if (matches(TERMINAL_BUNDLE_IDS, lower)) return "terminal";
  return "open";
}
function protectedBundleIds(env, kind = "type") {
  const ids = [...BLOCKED_BUNDLE_IDS, ...hostBundleIds(env), ...BROWSER_BUNDLE_IDS, ...kind === "click" ? [] : TERMINAL_BUNDLE_IDS];
  return [...new Set(ids)];
}
function protectedAppReason(bundleId, env, kind = "type") {
  const cls = screenAppClass(bundleId, env);
  if (cls === null) return "the target app could not be identified";
  if (cls === "blocked") {
    return `${bundleId} is protected (the agent's own terminal or app, system settings, credentials or a script runner)`;
  }
  if (cls === "browser") {
    return `${bundleId} is a web browser, which screen control only looks at; use the browser tool for web pages`;
  }
  if (cls === "terminal" && kind !== "click") {
    return `${bundleId} is a terminal or code editor, where screen control may click but not type or press keys; use os.shell.run for commands`;
  }
  return null;
}
const CMD = 1048576;
const SHIFT = 131072;
const CTRL = 262144;
const ALT = 524288;
const KEY_TAB = 48;
const KEY_BACKTICK = 50;
const KEY_SPACE = 49;
const KEY_ESCAPE = 53;
const ARROWS = /* @__PURE__ */ new Set([123, 124, 125, 126]);
function refusedChordReason(chord) {
  const mods = chord.flags & (CMD | SHIFT | CTRL | ALT);
  const cmd = (mods & CMD) !== 0;
  if (cmd && (chord.keyCode === KEY_TAB || chord.keyCode === KEY_BACKTICK)) {
    return `${chord.label} switches apps or windows`;
  }
  if (cmd && chord.keyCode === KEY_SPACE) return `${chord.label} opens Spotlight`;
  if ((mods & CTRL) !== 0 && chord.keyCode === KEY_SPACE) return `${chord.label} switches input source or opens a launcher`;
  if ((mods & ALT) !== 0 && chord.keyCode === KEY_SPACE) return `${chord.label} opens a launcher`;
  if ((mods & CTRL) !== 0 && ARROWS.has(chord.keyCode)) return `${chord.label} switches spaces or opens Mission Control`;
  if (cmd && (mods & ALT) !== 0 && chord.keyCode === KEY_ESCAPE) return `${chord.label} opens Force Quit`;
  return null;
}
export {
  BLOCKED_BUNDLE_IDS,
  BROWSER_BUNDLE_IDS,
  TERMINAL_BUNDLE_IDS,
  hostBundleIds,
  protectedAppReason,
  protectedBundleIds,
  refusedChordReason,
  screenAppClass
};
