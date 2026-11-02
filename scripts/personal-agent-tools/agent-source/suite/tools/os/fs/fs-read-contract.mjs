const NAME = "os.fs.read";
const OS_FS_READ_CONTRACT = {
  name: NAME,
  description: "Read a UTF-8 text file. Paths may be relative to the session working directory. Supports line-range reads via `offset` (1-indexed, negative counts from end) and `limit`, plus optional `LINE_NUMBER|` prefixes.",
  readonly: true,
  resourceClass: "pure_read",
  descriptor: {
    "name": "os.fs.read",
    "summary": "Read a UTF-8 file \u2014 the default for source code and text files; use offset/limit for ranges, lineNumbers for 'LINE|'.",
    "argsSchema": "{ path: string, maxBytes?: number, offset?: number /* 1-based; neg=from end */, limit?: number, lineNumbers?: boolean }"
  },
  argsJsonSchema: {
    "type": "object",
    "properties": {
      "path": {
        "type": "string"
      },
      "maxBytes": {
        "type": "number"
      },
      "offset": {
        "type": "number"
      },
      "limit": {
        "type": "number"
      },
      "lineNumbers": {
        "type": "boolean"
      }
    },
    "required": [
      "path"
    ],
    "additionalProperties": false
  }
};
const DEFAULT_MAX_BYTES = 64 * 1024;
function parseReadArgs(rawArgs) {
  const path = rawArgs.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("os.fs.read: `path` must be a non-empty string");
  }
  const maxBytes = typeof rawArgs.maxBytes === "number" && Number.isFinite(rawArgs.maxBytes) ? Math.max(1, Math.floor(rawArgs.maxBytes)) : DEFAULT_MAX_BYTES;
  const offset = typeof rawArgs.offset === "number" && Number.isFinite(rawArgs.offset) ? Math.trunc(rawArgs.offset) : void 0;
  const limit = typeof rawArgs.limit === "number" && Number.isFinite(rawArgs.limit) ? Math.max(0, Math.trunc(rawArgs.limit)) : void 0;
  const lineNumbers = rawArgs.lineNumbers === true;
  return { path, maxBytes, offset, limit, lineNumbers };
}
export {
  OS_FS_READ_CONTRACT,
  parseReadArgs
};
