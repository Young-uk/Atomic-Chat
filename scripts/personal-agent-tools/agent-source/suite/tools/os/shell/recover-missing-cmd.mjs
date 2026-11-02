import { coerceShellArgs } from "./shell-interpretation.mjs";
const SCRIPT_CODE_RE = /(?:^|[\n;])\s*(?:import\s+[\w.]+|from\s+[\w.]+\s+import\b|print\s*\(|def\s+\w+\s*\(|console\.\w+\s*\(|require\s*\(|process\.\w+\s*[.(\[]|(?:const|let|var)\s+\w+\s*=)/;
function looksLikeScriptCode(line) {
  return SCRIPT_CODE_RE.test(line);
}
function recoverMissingShellCmd(rawArgs, platform = process.platform) {
  const cmd = rawArgs.cmd;
  if (cmd !== void 0 && cmd !== null) {
    if (typeof cmd !== "string" || cmd.trim().length > 0) return null;
  }
  const tokens = coerceShellArgs(rawArgs.args);
  if (tokens === null || tokens.length === 0) return null;
  const first = tokens[0].trim();
  if (first.length === 0) return null;
  if (first === "-c") {
    if (platform === "win32") return null;
    const line = tokens[1]?.trim() ?? "";
    if (tokens.length !== 2 || line.length === 0) return null;
    if (looksLikeScriptCode(line)) return null;
    return { cmd: line, args: [], shellLine: true };
  }
  if (first.startsWith("-")) return null;
  if (platform === "win32" && first.startsWith("/")) return null;
  return { cmd: first, args: tokens.slice(1), shellLine: false };
}
function missingCmdNotice(recovered, ran) {
  const verb = ran ? "ran" : "read";
  const how = recovered.shellLine ? `${verb} the \`-c\` line as a shell command line (sh -c): ${JSON.stringify(recovered.cmd)}` : `${verb} it as ${JSON.stringify({ cmd: recovered.cmd, args: recovered.args })}`;
  return `os.shell.run: the call had no \`cmd\`; reconstructed from args and ${how}. Next time put the program in \`cmd\` and its arguments in \`args\`.`;
}
function markRecoveredResult(result, recovered) {
  const ran = "exitCode" in result.details || result.details.detached === true;
  const notice = missingCmdNotice(recovered, ran);
  const marked = {
    ...result,
    summary: `${result.summary}
${notice}`,
    details: {
      ...result.details,
      recoveredMissingCmd: recovered.shellLine ? "shell_line" : "argv"
    }
  };
  if (result.fullOutput !== void 0) {
    Object.defineProperty(marked, "fullOutput", {
      value: `${result.fullOutput}
${notice}`,
      enumerable: false
    });
    Object.defineProperty(marked, "fullOutputTruncated", {
      value: result.fullOutputTruncated === true,
      enumerable: false
    });
  }
  return marked;
}
const KEPT_IN_EXAMPLE = ["cwd", "timeoutMs", "keep", "background"];
function missingCmdMessage(rawArgs) {
  const example = { cmd: "git status" };
  for (const key of KEPT_IN_EXAMPLE) {
    if (rawArgs[key] !== void 0 && rawArgs[key] !== null) example[key] = rawArgs[key];
  }
  const shown = JSON.stringify(example);
  const keys = Object.keys(rawArgs).filter((key) => rawArgs[key] !== void 0);
  if (keys.length === 0) {
    return `os.shell.run: the call arrived with no arguments, so there was no command to run (if you wrote one, it did not reach the tool; send the whole call again). Put the command line in \`cmd\`, e.g. ${shown} or {"cmd":"git","args":["status"]}.`;
  }
  const got = rawArgs.cmd === void 0 ? "no `cmd`" : `\`cmd\` = ${JSON.stringify(rawArgs.cmd)}`;
  return `os.shell.run: \`cmd\` must be a non-empty string (got ${got} with ${keys.map((k) => `\`${k}\``).join(", ")}): put the program or the whole command line in \`cmd\`, e.g. ${shown}, and its arguments, if separate, in \`args\`.`;
}
export {
  looksLikeScriptCode,
  markRecoveredResult,
  missingCmdMessage,
  missingCmdNotice,
  recoverMissingShellCmd
};
