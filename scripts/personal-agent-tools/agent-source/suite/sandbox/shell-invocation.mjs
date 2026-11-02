function buildSubshellInvocation(commandLine) {
  if (process.platform === "win32") {
    const comSpec = typeof process.env.ComSpec === "string" && process.env.ComSpec.length > 0 ? process.env.ComSpec : "cmd.exe";
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", `"${commandLine}"`],
      windowsVerbatimArguments: true
    };
  }
  return {
    command: "sh",
    args: ["-c", commandLine],
    windowsVerbatimArguments: false
  };
}
const CMD_EXE_RE = /^(?:.*[\\/])?cmd(?:\.exe)?$/i;
function buildDirectInvocation(command, args) {
  if (process.platform === "win32" && CMD_EXE_RE.test(command)) {
    return {
      command,
      args: args.map(quoteCmdLineToken),
      windowsVerbatimArguments: true
    };
  }
  return { command, args: [...args], windowsVerbatimArguments: false };
}
function quoteCmdLineToken(token) {
  if (token.length === 0) return '""';
  if (token.includes('"') || !/\s/.test(token)) return token;
  return `"${token}"`;
}
const CMD_NEEDS_QUOTING_RE = /[\s"^&|<>()%!]/;
function quoteCmdArg(token) {
  if (token.length === 0) return '""';
  if (!CMD_NEEDS_QUOTING_RE.test(token)) return token;
  return `"${token.replace(/"/g, '""')}"`;
}
export {
  buildDirectInvocation,
  buildSubshellInvocation,
  quoteCmdArg
};
