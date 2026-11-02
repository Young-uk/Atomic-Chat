import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expandHome } from "../expand-home.mjs";
import { BROWSER_BUNDLE_IDS } from "../screen/screen-protected.mjs";
import { basenameCommand } from "./normalise.mjs";
import { lexShellLine } from "./shell-line-lexer.mjs";
const BROWSER_BYPASS_RULE = "browser.use_browser_tool";
const REFUSAL = `os.shell.run does not control web browsers: use the browser tool instead (browser.navigate / browser.tabs to open a page, browser.read_aria to read it, browser.click / browser.type to act). It asks before submits, payments and passwords, and the shell would skip that. If the browser tool cannot reach Chrome, tell the user what its error says rather than working around it. Quitting or starting the app is fine: osascript -e 'tell application "Google Chrome" to quit', open -a "Google Chrome"`;
function refuse(what) {
  return { action: "block", rule: BROWSER_BYPASS_RULE, reason: `${what}. ${REFUSAL}` };
}
const BROWSER_APP_NAME = /^(?:safari(?: technology preview)?|(?:google )?chrome(?: beta| dev| canary)?|chromium|arc|dia|(?:microsoft )?edge(?: beta| dev| canary)?|firefox(?: developer edition| nightly)?|firefox|brave(?: browser)?(?: beta| nightly)?|opera(?: gx| air)?|vivaldi|orion|duckduckgo|zen(?: browser)?|tor browser|yandex(?: browser)?|(?:naver )?whale|waterfox|mullvad browser|librewolf|floorp|sigmaos|helium|comet|(?:chatgpt )?atlas)$/;
const BROWSER_BINARY = /^(?:google-chrome(?:-stable|-beta|-unstable)?|chromium(?:-browser)?|chrome|msedge|microsoft-edge(?:-stable|-beta|-dev)?|brave(?:-browser)?(?:-stable|-beta|-nightly)?|firefox(?:-esr|-developer-edition)?|opera|vivaldi(?:-stable)?|librewolf|waterfox|floorp|zen|safari|epiphany|falkon|midori|qutebrowser)(?:\.exe)?$/;
const BROWSER_MENTION = new RegExp(
  [
    "\\b(?:safari|chrome|chromium|firefox|vivaldi|duckduckgo|librewolf|waterfox|floorp|sigmaos|yandex|thebrowser|torbrowser|tor browser|microsoft edge|msedge|brave|opera|operagx|webkit)\\b",
    `["'](?:arc|edge|orion|zen|zen browser|dia|helium|comet|atlas|chatgpt atlas|whale|mullvad browser)(?:\\.app)?["']`,
    ...BROWSER_BUNDLE_IDS.map((id) => id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  ].join("|")
);
const SCRIPTING_CONTEXT = /\bosascript\b|\bosacompile\b|applescript|appscript|scriptingbridge|sbapplication|osakit|\bjxa\b|nsworkspace/;
const SEP = `(?:\\s|["']?\\s*-e\\s*["']?|;|\xAC)+`;
const QUIT_OR_ACTIVATE = [
  new RegExp(`tell\\s+(?:application|app)\\s+(?:id\\s+)?"[^"$\`]*"\\s+to\\s+(?:quit|activate)(?:\\s+saving\\s+no)?`, "g"),
  new RegExp(`tell\\s+(?:application|app)\\s+(?:id\\s+)?"[^"$\`]*"${SEP}(?:quit|activate)(?:\\s+saving\\s+no)?${SEP}end\\s+tell`, "g"),
  /\b(?:quit|activate)\s+(?:application|app)\s+(?:id\s+)?"[^"$`]*"(?:\s+saving\s+no)?/g,
  /application\(\s*["'][^"'$`]*["']\s*\)\.(?:quit|activate)\(\s*\)/g
];
const SCRIPT_PROBLEMS = [
  { test: BROWSER_MENTION, what: "AppleScript/JavaScript for Automation that talks to a web browser" },
  {
    test: /system events[\s\S]*\b(?:keystroke|key\s+code|key\s+down|click)\b|\b(?:keystroke|key\s*code)\s*\(/,
    what: "synthesised keystrokes or clicks through System Events (they land in whatever app is in front, a browser included)"
  },
  {
    test: /\bopen\s+location\b|openlocation|openurl|open_url|https?:\/\/|file:\/\/|\.(?:html?|xhtml|webloc|inetloc|url|mhtml?|webarchive)\b/,
    what: "a script that opens a web address or a web file"
  },
  { test: /\b(?:do|execute)\b[^\n]{0,40}\bjavascript\b/, what: "a script that runs JavaScript in a web page" },
  {
    test: /tell\s+(?:application|app)\s+(?!(?:id\s+)?["'])|tell\s+(?:application|app)\s+(?:id\s+)?["'][^"']*[$`]|(?:application|app)\s+(?:id\s+)?"[^"]*"\s*&|application\(\s*(?!["'])|application\(\s*["'][^"']*["']\s*\+/,
    what: "a script whose target app is built at run time, so it cannot be checked"
  },
  {
    test: /\b(?:run|load)\s+script\b|\bosacompile\b|objc\s*\.\s*(?:import|bindfunction)|\beval\s*\(/,
    what: "a script that runs other script text, so it cannot be checked"
  },
  {
    test: /-e\s+["']?\$|\$\(|`/,
    what: "a script built at run time, so it cannot be checked"
  }
];
const LINE_PROBLEMS = [
  {
    test: /devtoolsactiveport|remote-debugging-(?:port|pipe|address)|(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+\/json\b|\/devtools\/(?:browser|page)\/|connectovercdp|connect_over_cdp|browserwsendpoint|chrome-remote-interface|chrome-devtools-mcp/,
    what: "the browser's DevTools connection"
  },
  {
    test: /\bimport\s+webbrowser\b|\bfrom\s+webbrowser\b|-m\s+webbrowser\b|\bwebbrowser\s*\.\s*open|require\(\s*["']open["']\s*\)|from\s+["']open["']/,
    what: "a script that opens the default browser"
  },
  { test: /\bshortcuts\s+run\b|\bautomator\s/, what: "Shortcuts/Automator workflows (their steps are not visible here)" },
  {
    test: /\bdefaults\s+(?:-currenthost\s+)?(?:write|delete|import|rename)\s+(?:~\/library\/preferences\/)?(?:com\.apple\.safari|com\.google\.chrome|org\.chromium|com\.brave|com\.microsoft\.edge|org\.mozilla|company\.thebrowser|com\.operasoftware|com\.vivaldi|com\.kagi|com\.duckduckgo)/,
    what: "changing a web browser's settings"
  },
  {
    test: /(?:\bbase64\s+(?:-[a-z]*d|--decode)|\bb64decode\b|\batob\s*\(|\bxxd\s+-r|\bopenssl\s+(?:enc\s+)?-?base64\s+-d)[\s\S]*(?:\|\s*(?:sudo\s+)?(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|fish|osascript|python\d*(?:\.\d+)?|perl|ruby|node|xargs|open|eval)\b|\beval\b|\bexec\s*\(|\bos\.system\b|\bsubprocess\b)|\beval\b[\s\S]*(?:\bbase64\s+(?:-[a-z]*d|--decode)|\bxxd\s+-r)/,
    what: "a command decoded at run time, so it cannot be checked"
  },
  {
    test: /(?:^|[\s;&|(`'"])(?:\S*\/)?(?:open|xdg-open|wslview)\s+(?:-[a-z]+\s+)*["']?(?:https?|ftp|file|javascript|data|view-source):/,
    what: "opening a web address in the browser"
  },
  {
    // `system("open", "-a", "Safari", "https://…")`, `subprocess.run(["open", url])` with the URL spelled out.
    test: /["'](?:open|xdg-open)["']\s*,\s*(?:["']-[a-z]["']\s*,\s*(?:["'][^"']*["']\s*,\s*)?)*["'](?:https?|ftp|file|javascript|data):/,
    what: "opening a web address in the browser"
  }
];
const PREFIX_COMMANDS = {
  sudo: ["-u", "-g", "-h", "-p", "-c", "-r", "-t", "-C", "-D", "-U"],
  doas: ["-u", "-C"],
  env: ["-u", "-C", "-P", "--unset", "--chdir"],
  command: [],
  builtin: [],
  exec: ["-a"],
  nohup: [],
  nice: ["-n", "--adjustment"],
  time: ["-f", "-o", "--format", "--output"],
  caffeinate: ["-t", "-w"],
  arch: [],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  gtimeout: ["-s", "-k", "--signal", "--kill-after"],
  stdbuf: ["-i", "-o", "-e"],
  unbuffer: [],
  noglob: [],
  xargs: ["-I", "-i", "-n", "-L", "-l", "-P", "-d", "-E", "-e", "-s", "-a", "--max-args", "--max-procs", "--delimiter", "--arg-file", "--replace"],
  watch: ["-n", "-d", "--interval"]
};
const NESTED_SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
const WEB_SCHEME = /^(?:https?|ftp|file|javascript|data|about|view-source|chrome|edge|brave|opera|vivaldi|safari-\S*|x-safari-https?|googlechromes?|firefox|microsoft-edge|webcal):/i;
const WEB_FILE = /\.(?:html?|xhtml|shtml|webloc|inetloc|url|mhtml?|webarchive|svg|xml)$/i;
const BARE_HOST = /^(?:www\.)[^\s/]+|^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i;
function isBrowserAppName(value) {
  const name = basenameCommand(value.replace(/\/+$/, "")).toLowerCase().replace(/\.app$/, "").trim();
  return BROWSER_APP_NAME.test(name);
}
function isBrowserBundleId(value) {
  const id = value.toLowerCase();
  return BROWSER_BUNDLE_IDS.some((known) => {
    const k = known.toLowerCase();
    return id === k || id.startsWith(`${k}.`);
  });
}
function isWebTarget(word) {
  const text = word.text.trim();
  return WEB_SCHEME.test(text) || WEB_FILE.test(text) || BARE_HOST.test(text);
}
function checkBrowserBypassLine(line, cwd) {
  return checkText(line, line) ?? checkLineCommands(line, { viaXargs: false, depth: 0, cwd });
}
function checkBrowserBypassArgv(cmd, args, cwd) {
  const words = [cmd, ...args].map((text2) => ({ text: text2, dynamic: false }));
  const text = [cmd, ...args].join(" ");
  return checkText(text, text) ?? checkCommand(words, { viaXargs: false, depth: 0, cwd });
}
const SCRIPT_RUNNERS = /^(?:sh|bash|zsh|dash|ksh|fish|csh|tcsh|python\d*(?:\.\d+)?|node|deno|bun|tsx|ts-node|ruby|perl|php|swift|lua|osascript|jxa)$/;
const SCRIPT_READ_CAP = 1e6;
function readScriptFile(word, cwd) {
  if (word.dynamic) return null;
  try {
    const path = resolve(cwd, expandHome(word.text));
    const info = statSync(path);
    if (!info.isFile() || info.size > SCRIPT_READ_CAP) return null;
    const text = readFileSync(path, "utf8");
    return text.includes("\0") ? "binary" : text;
  } catch {
    return null;
  }
}
function checkScriptFile(word, ctx, shell) {
  const text = readScriptFile(word, ctx.cwd);
  if (text === null || text === "binary") return null;
  return checkText(text, text) ?? (shell ? checkLineCommands(text, { ...ctx, depth: ctx.depth + 1 }) : null);
}
function checkText(raw, osascriptSource) {
  const text = raw.normalize("NFKC").toLowerCase();
  for (const problem of LINE_PROBLEMS) {
    if (problem.test.test(text)) return refuse(problem.what);
  }
  if (SCRIPTING_CONTEXT.test(text)) {
    let rest = text;
    for (const allowed of QUIT_OR_ACTIVATE) rest = rest.replace(allowed, " ");
    for (const problem of SCRIPT_PROBLEMS) {
      if (problem.test.test(rest)) return refuse(problem.what);
    }
    const hidden = hiddenOsascriptSource(osascriptSource.normalize("NFKC").toLowerCase());
    if (hidden !== null) return refuse(hidden);
  }
  return null;
}
function hiddenOsascriptSource(text) {
  const piped = /\|\s*(?:\S*\/)?osascript\b/.test(text);
  if (piped && !/(?:^|[;&|(]\s*)(?:echo|printf)\b[^|;&]*\|\s*(?:\S*\/)?osascript\b/.test(text)) {
    return "a script piped into osascript from somewhere this cannot read";
  }
  if (/\bosascript\b[^|;&\n]*(?<!<)<(?![<(])/.test(text)) {
    return "a script read into osascript from a file";
  }
  return null;
}
function checkLineCommands(line, ctx) {
  if (ctx.depth > 4) return null;
  const tokens = lexShellLine(line, "posix");
  if (tokens === null) return null;
  let words = [];
  const flush = () => {
    const verdict = words.length > 0 ? checkCommand(words, ctx) : null;
    words = [];
    return verdict;
  };
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.kind === "word") {
      words.push(token);
      continue;
    }
    if (token.kind === "redirect") {
      k += 1;
      continue;
    }
    const verdict = flush();
    if (verdict) return verdict;
  }
  return flush();
}
function checkCommand(all, outer) {
  const dequoted = all.map((word) => word.text).join(" ");
  const asText = checkText(dequoted, dequoted);
  if (asText) return asText;
  const ctx = { ...outer };
  let i = 0;
  while (i < all.length) {
    const word = all[i].text;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ["!", "{", "if", "then", "else", "elif", "while", "until", "do"].includes(word)) {
      i += 1;
      continue;
    }
    const name2 = basenameCommand(word).toLowerCase();
    const valueFlags = PREFIX_COMMANDS[name2];
    if (valueFlags === void 0) break;
    if (name2 === "xargs") ctx.viaXargs = true;
    i += 1;
    while (i < all.length) {
      const next = all[i].text;
      if (name2 === "env" && (next === "-S" || next === "--split-string")) {
        const split = all[i + 1];
        return split ? checkLineCommands(split.text, { ...ctx, depth: ctx.depth + 1 }) : null;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(next) && name2 === "env") {
        i += 1;
        continue;
      }
      if (!next.startsWith("-")) break;
      i += valueFlags.includes(next) ? 2 : 1;
    }
    if ((name2 === "timeout" || name2 === "gtimeout") && /^\d/.test(all[i]?.text ?? "")) i += 1;
    if (name2 === "arch" && /^-/.test(all[i]?.text ?? "")) i += 1;
  }
  const head = all[i];
  if (head === void 0) return null;
  const name = basenameCommand(head.text).toLowerCase();
  const args = all.slice(i + 1);
  if (NESTED_SHELLS.has(name)) {
    for (let j = 0; j < args.length; j++) {
      const flag = args[j].text;
      if (!flag.startsWith("-")) return checkScriptFile(args[j], ctx, true);
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag)) {
        const script = args[j + 1];
        return script ? checkText(script.text, script.text) ?? checkLineCommands(script.text, { ...ctx, depth: ctx.depth + 1 }) : null;
      }
    }
    return null;
  }
  if (name !== "osascript" && SCRIPT_RUNNERS.test(name)) {
    const file = args.find((a) => !a.text.startsWith("-"));
    if (file === void 0 || args.some((a) => /^-[a-zA-Z]*[ce]$/.test(a.text) || a.text === "-m")) return null;
    return checkScriptFile(file, ctx, false);
  }
  if (/[/\\]/.test(head.text) && !isBrowserExecutable(head.text)) {
    const verdict = checkScriptFile(head, ctx, true);
    if (verdict) return verdict;
  }
  if (name === "eval") {
    const line = args.map((a) => a.text).join(" ");
    return checkText(line, line) ?? checkLineCommands(line, { ...ctx, depth: ctx.depth + 1 });
  }
  if (name === "find") {
    const at = args.findIndex((a) => /^-(?:exec|execdir|ok|okdir)$/.test(a.text));
    if (at === -1) return null;
    const end = args.findIndex((a, k) => k > at && (a.text === ";" || a.text === "+"));
    return checkCommand(args.slice(at + 1, end === -1 ? void 0 : end), { ...ctx, viaXargs: true });
  }
  if (name === "open") return checkMacOpen(args, ctx);
  if (["xdg-open", "gnome-open", "kde-open", "kde-open5", "wslview", "start", "explorer", "explorer.exe"].includes(name)) {
    return checkOpener(args, ctx);
  }
  if (name === "gio" && args[0]?.text === "open") return checkOpener(args.slice(1), ctx);
  if (["sensible-browser", "x-www-browser", "www-browser", "gnome-www-browser"].includes(name)) {
    return refuse("starting the default web browser");
  }
  if ((name === "rundll32" || name === "rundll32.exe") && args.some((a) => /url\.dll|ieframe\.dll|shdocvw/i.test(a.text))) {
    return refuse("opening a web address in the browser");
  }
  if (isBrowserExecutable(head.text)) {
    const meaningful = args.filter((a) => !/^--?(?:version|help|v)$/i.test(a.text));
    if (meaningful.length > 0 || ctx.viaXargs) return refuse("running a web browser's program with arguments");
    return null;
  }
  if (name === "osascript") return checkOsascriptArgs(args, ctx);
  if (name === "source" || name === ".") return args[0] ? checkScriptFile(args[0], ctx, true) : null;
  if (["cliclick", "wtype"].includes(name)) return refuse("synthesised keystrokes or clicks");
  if (["xdotool", "ydotool"].includes(name) && args.some((a) => /^(?:type|key|keydown|keyup|click|mousedown|mouseup|mousemove)$/.test(a.text))) {
    return refuse("synthesised keystrokes or clicks");
  }
  return null;
}
function isBrowserExecutable(path) {
  const lower = path.toLowerCase();
  if (BROWSER_BINARY.test(basenameCommand(lower))) return true;
  const bundle = /([^/]+)\.app\/contents\/macos\//.exec(lower);
  return bundle !== null && BROWSER_APP_NAME.test(bundle[1]);
}
function checkMacOpen(args, ctx) {
  const valueFlags = /* @__PURE__ */ new Set(["-a", "-b", "-s", "--env", "--stdin", "--stdout", "--stderr", "-u"]);
  let app = null;
  let bundle = null;
  let reveal = false;
  let toEditor = false;
  let appArgs = false;
  const operands = [];
  for (let j = 0; j < args.length; j++) {
    const word = args[j];
    const text = word.text;
    if (text === "--args") {
      appArgs = j + 1 < args.length;
      break;
    }
    if (text === "-u" || text === "--url") return refuse("opening a web address in the browser");
    if (valueFlags.has(text)) {
      const value = args[j + 1];
      if (text === "-a") app = value ?? null;
      if (text === "-b") bundle = value ?? null;
      j += 1;
      continue;
    }
    if (text.startsWith("-") && text.length > 1) {
      if (/^-[a-zA-Z]*R/.test(text)) reveal = true;
      if (/^-[a-zA-Z]*[et]/.test(text)) toEditor = true;
      continue;
    }
    operands.push(word);
  }
  if (reveal) return null;
  const toBrowser = app !== null && (app.dynamic || isBrowserAppName(app.text)) || bundle !== null && (bundle.dynamic || isBrowserBundleId(bundle.text));
  if (toBrowser && (operands.length > 0 || appArgs || ctx.viaXargs)) {
    return refuse("handing a page, file or arguments to a web browser");
  }
  if (toBrowser) return null;
  const otherApp = app !== null || bundle !== null || toEditor;
  for (const word of operands) {
    if (WEB_SCHEME.test(word.text.trim()) || BARE_HOST.test(word.text.trim())) {
      if (!otherApp || /^(?:https?|ftp|file|javascript|data):/i.test(word.text.trim())) {
        return refuse("opening a web address in the browser");
      }
    }
    if (!otherApp && WEB_FILE.test(word.text.trim())) return refuse("opening a web page file in the browser");
    if (!otherApp && word.dynamic) return refuse("opening something only known at run time (it may be a web address)");
  }
  if (!otherApp && ctx.viaXargs) return refuse("opening something only known at run time (it may be a web address)");
  return null;
}
function checkOpener(args, ctx) {
  const operands = args.filter((a) => !a.text.startsWith("-") && !/^\/[a-z?]+$/i.test(a.text));
  if (operands.some((a) => a.dynamic || isWebTarget(a))) return refuse("opening a web address or web page in the browser");
  if (ctx.viaXargs) return refuse("opening something only known at run time (it may be a web address)");
  return null;
}
function checkOsascriptArgs(args, ctx) {
  let inline = false;
  for (let j = 0; j < args.length; j++) {
    const text = args[j].text;
    if (inline && !text.startsWith("-")) break;
    if (text === "-e") {
      inline = true;
      if (args[j + 1]?.dynamic) return refuse("a script built at run time, so it cannot be checked");
      j += 1;
      continue;
    }
    if (text === "-l" || text === "-s") {
      j += 1;
      continue;
    }
    if (/^-[a-zA-Z]*$/.test(text)) {
      if (text === "-") return refuse("a script read into osascript from somewhere this cannot read");
      continue;
    }
    const script = readScriptFile(args[j], ctx.cwd);
    if (script === null || script === "binary") {
      return refuse("an osascript script file that cannot be read here (pass the script inline with -e so it can be checked)");
    }
    return checkText(`osascript
${script}`, script);
  }
  if (ctx.viaXargs) return refuse("a script read into osascript from somewhere this cannot read");
  return null;
}
export {
  BROWSER_BYPASS_RULE,
  checkBrowserBypassArgv,
  checkBrowserBypassLine
};
