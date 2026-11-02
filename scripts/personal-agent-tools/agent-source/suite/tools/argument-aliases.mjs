import { readMoveAliases } from "./os/fs/fs-move-aliases.mjs";
import { readShellAliases } from "./os/shell/shell-aliases.mjs";
const READERS = /* @__PURE__ */ new Map([
  ["os.fs.move", (args, options) => readMoveAliases(args, options)],
  ["os.shell.run", (args) => readShellAliases(args)]
]);
function readArgumentAliases(tool, args, options = {}) {
  return READERS.get(tool)?.(args, options) ?? null;
}
function canonicalArgs(tool, args) {
  return readArgumentAliases(tool, args)?.args ?? args;
}
function withAliasNote(result, note) {
  const noted = {
    ...result,
    summary: `${result.summary}
${note}`
  };
  if (result.fullOutput !== void 0) {
    Object.defineProperty(noted, "fullOutput", { value: `${result.fullOutput}
${note}`, enumerable: false });
    Object.defineProperty(noted, "fullOutputTruncated", { value: result.fullOutputTruncated, enumerable: false });
  }
  return noted;
}
export {
  canonicalArgs,
  readArgumentAliases,
  withAliasNote
};
