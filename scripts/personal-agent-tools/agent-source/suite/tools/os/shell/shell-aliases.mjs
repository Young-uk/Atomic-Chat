const CMD_ALIASES = [
  "command",
  "cmdline",
  "commandLine",
  "command_line",
  "shell_command",
  "shellCommand"
];
function commandValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.length > 0);
}
function readShellAliases(args) {
  const cmd = args.cmd;
  if (cmd !== void 0 && cmd !== null && cmd !== "") return null;
  const used = CMD_ALIASES.filter((key2) => Object.hasOwn(args, key2));
  if (used.length !== 1) return null;
  const key = used[0];
  const value = args[key];
  if (!commandValue(value)) return null;
  const out = { ...args, cmd: value };
  delete out[key];
  return {
    args: out,
    note: `note: read \`${key}\` as \`cmd\`; os.shell.run takes the command in \`cmd\` (e.g. {"cmd":"git status"} or {"cmd":"git","args":["status"]}).`
  };
}
export {
  readShellAliases
};
