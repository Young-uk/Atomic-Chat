const NAME = "os.fs.write";
const OS_FS_WRITE_CONTRACT = {
  name: NAME,
  description: "Write text content to a file (creating parents). Dangerous \u2014 always requires approval.",
  readonly: false,
  resourceClass: "approval_gated",
  descriptor: {
    name: NAME,
    summary: "Write or append to a file (may require approval). It always makes a file, never a folder \u2014 to put files into a new folder, os.fs.move them there (it creates the folder); only an empty folder needs the shell (`mkdir`), never an empty write. The result says when it replaced a pre-existing file and with what line counts; a replaced pre-existing file can be brought back with os.fs.restore. A file the request names as an input is refused: edit it in place or write the result to a new file.",
    argsSchema: '{ path: string, content: string, mode?: "replace" | "append" }'
  },
  argsJsonSchema: {
    type: "object",
    properties: {
      path: {
        type: "string"
      },
      content: {
        type: "string"
      },
      mode: {
        type: "string",
        enum: [
          "replace",
          "append"
        ]
      },
      overwrite: {
        type: "boolean"
      }
    },
    required: [
      "path",
      "content"
    ],
    additionalProperties: false
  }
};
function parseWriteArgs(rawArgs) {
  const path = rawArgs.path;
  const content = rawArgs.content;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("os.fs.write: `path` must be a non-empty string");
  }
  if (typeof content !== "string") {
    throw new Error("os.fs.write: `content` must be a string");
  }
  const mode = typeof rawArgs.mode === "string" && rawArgs.mode === "append" ? "append" : "replace";
  const overwrite = rawArgs.overwrite === true;
  return { path, content, mode, overwrite };
}
export {
  OS_FS_WRITE_CONTRACT,
  parseWriteArgs
};
