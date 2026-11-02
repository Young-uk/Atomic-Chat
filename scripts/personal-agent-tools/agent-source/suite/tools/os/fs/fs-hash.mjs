import {
  OS_FS_HASH_CONTRACT,
  parseHashArgs
} from "./fs-hash-contract.mjs";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { orMissing } from "./fs-missing-path.mjs";
const osFsHashTool = {
  name: OS_FS_HASH_CONTRACT.name,
  description: OS_FS_HASH_CONTRACT.description,
  readonly: OS_FS_HASH_CONTRACT.readonly,
  async run(rawArgs, ctx) {
    const args = parseHashArgs(rawArgs);
    const absolute = resolveUserPath(args.path, ctx.workingDir);
    const info = await orMissing(
      "os.fs.hash",
      absolute,
      ctx,
      () => stat(absolute)
    );
    if ("missing" in info) return info.missing;
    if (!info.isFile()) {
      throw new Error(`os.fs.hash: ${absolute} is not a regular file`);
    }
    const digest = await computeDigest(absolute, args.algorithm, args.encoding);
    return compressToolResult({
      tool: "os.fs.hash",
      status: "ok",
      output: `${args.algorithm}:${digest}  ${absolute}`,
      details: {
        path: absolute,
        algorithm: args.algorithm,
        encoding: args.encoding,
        digest,
        size: info.size
      }
    });
  }
};
function computeDigest(path, algorithm, encoding) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hasher = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("error", rejectPromise);
    stream.on("data", (chunk) => hasher.update(chunk));
    stream.on("end", () => resolvePromise(hasher.digest(encoding)));
  });
}
export {
  osFsHashTool
};
