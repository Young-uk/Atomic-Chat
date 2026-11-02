const NAME = "os.fs.restore";
const OS_FS_RESTORE_CONTRACT = {
  name: NAME,
  description: "Bring back the previous content of a file that os.fs.write / os.fs.edit / os.fs.patch replaced or shrank in this working directory \u2014 by this session or another (a fusion worker's included); the copy is saved automatically. Dangerous \u2014 always requires approval.",
  readonly: false,
  resourceClass: "approval_gated",
  descriptor: {
    name: NAME,
    summary: "Bring back the previous content of a file that os.fs.write / os.fs.edit / os.fs.patch replaced or shrank in this working directory, by this session or another \u2014 the result of that call said it was saved (may require approval).",
    argsSchema: "{ path: string }",
    tier: "rare"
  },
  argsJsonSchema: {
    type: "object",
    properties: {
      path: {
        type: "string"
      }
    },
    required: [
      "path"
    ],
    additionalProperties: false
  }
};
function parseRestoreArgs(rawArgs) {
  const path = rawArgs.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("os.fs.restore: `path` must be a non-empty string");
  }
  return { path };
}
export {
  OS_FS_RESTORE_CONTRACT,
  parseRestoreArgs
};
