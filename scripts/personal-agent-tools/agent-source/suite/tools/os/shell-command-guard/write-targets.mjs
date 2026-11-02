import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { expandHome, resolveUserPath } from "../expand-home.mjs";
import { basenameCommand } from "./normalise.mjs";
import {
  lexShellLine
} from "./shell-line-lexer.mjs";
function shellWriteTargets(commandLine, cwd) {
  const windows = process.platform === "win32";
  const targets = lineTargets(commandLine, cwd, windows ? "cmd" : "posix", windows);
  return targets === null ? [] : unique(targets);
}
function execWriteTargets(cmd, args, cwd) {
  const words = [cmd, ...args].map((text) => ({ text, dynamic: false }));
  const found = commandTargets(words, cwd, process.platform === "win32");
  return found === null ? [] : unique(found.targets);
}
const NESTED_SHELLS = /* @__PURE__ */ new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh"
]);
const PREFIX_COMMANDS = /* @__PURE__ */ new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nohup",
  "nice",
  "time"
]);
const KEYWORDS = /* @__PURE__ */ new Set([
  "!",
  "{",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do"
]);
const CHANGES_EVERY_OPERAND = /* @__PURE__ */ new Set([
  "rm",
  "unlink",
  "rmdir",
  "shred",
  "trash",
  "touch",
  "truncate",
  "mv",
  "tee"
]);
const CHANGES_LAST_OPERAND = /* @__PURE__ */ new Set([
  "cp",
  "ln",
  "rsync",
  "ditto"
]);
const TARGET_DIRECTORY_FLAG = /* @__PURE__ */ new Set(["cp", "mv", "ln"]);
const VALUE_FLAGS = {
  touch: (f) => ["-t", "-d", "-r", "--date", "--reference"].includes(f),
  truncate: (f) => ["-s", "-r", "--size", "--reference"].includes(f),
  shred: (f) => ["-n", "-s", "--iterations", "--size"].includes(f),
  cp: (f) => f === "-S" || f === "--suffix",
  mv: (f) => f === "-S" || f === "--suffix",
  ln: (f) => f === "-S" || f === "--suffix",
  rsync: (f) => ["-e", "--rsh", "-f", "--filter", "--exclude", "--include"].includes(f),
  sed: (f) => /^-[nErsuz]*[ef]$/.test(f) || ["-l", "--expression", "--file"].includes(f),
  perl: (f) => /^-[a-zA-Z0-9]*[eE]$/.test(f)
};
const CMD_CHANGES_EVERY_OPERAND = /* @__PURE__ */ new Set([
  "del",
  "erase",
  "rd",
  "move",
  "ren",
  "rename"
]);
const POWERSHELL_TARGETS = {
  "remove-item": { named: ["-path", "-literalpath"], positional: [0] },
  "new-item": { named: ["-path"], positional: [0] },
  "set-content": { named: ["-path", "-literalpath"], positional: [0] },
  "add-content": { named: ["-path", "-literalpath"], positional: [0] },
  "clear-content": { named: ["-path", "-literalpath"], positional: [0] },
  "out-file": { named: ["-filepath", "-literalpath", "-path"], positional: [0] },
  "move-item": {
    named: ["-path", "-literalpath", "-destination"],
    positional: [0, 1]
  },
  "copy-item": { named: ["-destination"], positional: [1] }
};
function lineTargets(line, dir, dialect, windows) {
  const tokens = lexShellLine(line, dialect);
  if (tokens === null) return null;
  const targets = [];
  const outer = [];
  let cwd = dir;
  let words = [];
  const flush = () => {
    if (words.length === 0) return true;
    const found = commandTargets(words, cwd, windows);
    words = [];
    if (found === null) return false;
    targets.push(...found.targets);
    cwd = found.dir;
    return true;
  };
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.kind === "word") {
      words.push(token);
      continue;
    }
    if (token.kind === "redirect") {
      const next = tokens[k + 1];
      if (next?.kind !== "word") return null;
      k += 1;
      const isFile = token.writes === "file" || token.writes === "dup" && !/^(?:\d+|-)$/.test(next.text);
      const target = isFile ? resolveWord(next, cwd) : void 0;
      if (target !== void 0) targets.push(target);
      continue;
    }
    if (!flush()) return null;
    if (token.kind === "open") outer.push(cwd);
    else if (token.kind === "close" && outer.length > 0) cwd = outer.pop();
  }
  if (!flush()) return null;
  return targets;
}
function commandTargets(words, dir, windows) {
  let i = 0;
  while (i < words.length) {
    const word = words[i].text;
    if (KEYWORDS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i += 1;
      continue;
    }
    if (!PREFIX_COMMANDS.has(commandName(word))) break;
    i += 1;
    while (i < words.length && words[i].text.startsWith("-")) i += 1;
  }
  const head = words[i];
  const none = { targets: [], dir };
  if (head === void 0 || head.dynamic) return none;
  const name = commandName(head.text);
  const args = words.slice(i + 1);
  if (name === "cd" || name === "pushd") {
    const operands = windows ? cmdOperands(args) : plainOperands(args);
    const to = operands[0];
    if (to === void 0) return { targets: [], dir: homedir() };
    return { targets: [], dir: to.text === "-" ? void 0 : resolveWord(to, dir) };
  }
  if (name === "popd") return { targets: [], dir: void 0 };
  const nested = nestedLine(name, args);
  if (nested !== void 0) {
    if (nested === null) return none;
    const targets2 = lineTargets(
      nested.line,
      dir,
      nested.dialect,
      windows || nested.dialect !== "posix"
    );
    return targets2 === null ? null : { targets: targets2, dir };
  }
  const targets = [];
  for (const word of changedWords(name, args, windows)) {
    const target = resolveWord(word, dir);
    if (target !== void 0) targets.push(target);
  }
  return { targets, dir };
}
function nestedLine(name, args) {
  if (NESTED_SHELLS.has(name)) {
    for (let j = 0; j < args.length; j++) {
      const flag = args[j].text;
      if (!/^[-+]/.test(flag)) return null;
      if (/^[-+][oO]$/.test(flag)) {
        j += 1;
        continue;
      }
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(flag)) {
        const script = args[j + 1];
        return script === void 0 || script.dynamic ? null : { line: script.text, dialect: "posix" };
      }
    }
    return null;
  }
  if (name === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg.text));
    return at === -1 ? null : { line: joinWords(args.slice(at + 1)), dialect: "cmd" };
  }
  if (name === "powershell" || name === "pwsh") {
    const at = args.findIndex((arg) => /^-(?:c|command)$/i.test(arg.text));
    return at === -1 ? null : { line: joinWords(args.slice(at + 1)), dialect: "powershell" };
  }
  return void 0;
}
function changedWords(name, args, windows) {
  const takesValue = VALUE_FLAGS[name];
  if (TARGET_DIRECTORY_FLAG.has(name) && args.some(
    (arg) => /^-[a-zA-Z]*t/.test(arg.text) || arg.text.startsWith("--target-directory")
  )) {
    return [];
  }
  if (CHANGES_EVERY_OPERAND.has(name)) return plainOperands(args, takesValue);
  if (CHANGES_LAST_OPERAND.has(name)) {
    const operands = plainOperands(args, takesValue);
    return operands.length > 1 ? operands.slice(-1) : [];
  }
  if (name === "sed" || name === "perl") return inPlaceFiles(name, args);
  if (name === "dd") {
    return args.filter((arg) => arg.text.startsWith("of=")).map((arg) => ({ ...arg, text: arg.text.slice("of=".length) }));
  }
  if (!windows) return [];
  if (CMD_CHANGES_EVERY_OPERAND.has(name)) return cmdOperands(args);
  if (name === "copy") {
    const operands = cmdOperands(args);
    return operands.length > 1 ? operands.slice(-1) : [];
  }
  const cmdlet = POWERSHELL_TARGETS[name];
  return cmdlet === void 0 ? [] : powershellTargets(args, cmdlet);
}
function inPlaceFiles(name, args) {
  const inPlace = name === "sed" ? args.some(
    (arg) => /^-[nErsuz]*i/.test(arg.text) || arg.text.startsWith("--in-place")
  ) : args.some((arg) => /^-[anplsw0-9]*i/.test(arg.text));
  if (!inPlace) return [];
  const takesValue = VALUE_FLAGS[name];
  const scriptGiven = args.some(
    (arg) => takesValue(arg.text) && !["-l"].includes(arg.text)
  );
  const operands = plainOperands(args, takesValue).filter((arg) => arg.text !== "");
  return scriptGiven ? operands : operands.slice(1);
}
function plainOperands(args, takesValue) {
  const operands = [];
  let flagsDone = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k];
    if (!flagsDone && arg.text === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && arg.text.startsWith("-") && arg.text.length > 1) {
      if (takesValue?.(arg.text) === true) k += 1;
      continue;
    }
    operands.push(arg);
  }
  return operands;
}
function cmdOperands(args) {
  return args.filter((arg) => !/^\/[A-Za-z?](?::\S*)?$/.test(arg.text));
}
function powershellTargets(args, cmdlet) {
  const leading = [];
  for (const arg of args) {
    if (arg.text.startsWith("-")) break;
    leading.push(arg);
  }
  const found = cmdlet.positional.flatMap((at) => leading[at] ?? []);
  for (let k = 0; k + 1 < args.length; k++) {
    if (cmdlet.named.includes(args[k].text.toLowerCase())) found.push(args[k + 1]);
  }
  return found;
}
function commandName(word) {
  return basenameCommand(word).toLowerCase().replace(/\.exe$/, "");
}
function joinWords(words) {
  if (words.length === 1) return words[0].text;
  return words.map(({ text }) => /\s/.test(text) ? `"${text}"` : text).join(" ");
}
function resolveWord(word, dir) {
  const text = word.text;
  if (word.dynamic || text.length === 0 || text === "-") return void 0;
  if (text.startsWith("/dev/") || /^nul$/i.test(text)) return void 0;
  if (dir === void 0 && !isAbsolute(expandHome(text))) return void 0;
  try {
    return resolve(resolveUserPath(text, dir ?? homedir()));
  } catch {
    return void 0;
  }
}
function unique(paths) {
  return [...new Set(paths)];
}
export {
  execWriteTargets,
  shellWriteTargets
};
