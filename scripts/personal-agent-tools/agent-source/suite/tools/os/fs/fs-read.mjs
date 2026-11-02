import { OS_FS_READ_CONTRACT, parseReadArgs as parseArgs } from "./fs-read-contract.mjs";
import { open, realpath, stat } from "node:fs/promises";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import {
  hashReadContent,
  READ_COVERAGE_DETAIL_KEY,
  splitReadLines
} from "./fs-read-coverage.mjs";
import { notARegularFileMessage } from "./fs-read-not-a-file.mjs";
import { orMissing } from "./fs-missing-path.mjs";
const osFsReadTool = {
  name: OS_FS_READ_CONTRACT.name,
  description: OS_FS_READ_CONTRACT.description,
  readonly: OS_FS_READ_CONTRACT.readonly,
  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    const absolute = resolveUserPath(args.path, ctx.workingDir);
    const info = await orMissing(
      "os.fs.read",
      absolute,
      ctx,
      () => stat(absolute)
    );
    if ("missing" in info) return info.missing;
    if (!info.isFile()) {
      throw new Error(notARegularFileMessage(absolute, info));
    }
    const canonical = await canonicalize(absolute);
    const result = args.offset !== void 0 || args.limit !== void 0 ? await readByLines(absolute, canonical, info.size, args) : await readByBytes(absolute, canonical, info.size, args);
    rememberReadVersion(ctx.fileVersions, canonical, info.size, result.details);
    return result;
  }
};
function rememberReadVersion(store, canonical, size, details) {
  if (store === void 0) return;
  const coverageDetail = details[READ_COVERAGE_DETAIL_KEY];
  const contentHash = coverageDetail?.contentHash;
  const hashedBytes = details.bytesRead;
  if (typeof contentHash !== "string" || typeof hashedBytes !== "number") return;
  store.record(canonical, { size, hashedBytes, contentHash });
}
async function canonicalize(absolute) {
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}
async function readByBytes(absolute, canonical, size, args) {
  const handle = await open(absolute, "r");
  try {
    const toRead = Math.min(size, args.maxBytes);
    const buffer = Buffer.alloc(toRead);
    if (toRead > 0) {
      await handle.read(buffer, 0, toRead, 0);
    }
    const truncated = size > args.maxBytes;
    const body = buffer.toString("utf8");
    const text = args.lineNumbers ? prefixLineNumbers(body, 1) : body;
    const lineCount = splitReadLines(body).length;
    return compressToolResult(
      {
        tool: "os.fs.read",
        status: "ok",
        output: text,
        details: {
          path: absolute,
          size,
          truncated,
          bytesRead: toRead,
          [READ_COVERAGE_DETAIL_KEY]: coverage(canonical, buffer, args, {
            startLine: lineCount === 0 ? 0 : 1,
            endLine: lineCount,
            totalLines: lineCount,
            truncated
          })
        }
      },
      { maxSummaryLength: args.maxBytes, maxTailLines: 500 }
    );
  } finally {
    await handle.close();
  }
}
async function readByLines(absolute, canonical, size, args) {
  const handle = await open(absolute, "r");
  let allLines;
  let buffer;
  try {
    const toRead = Math.min(size, args.maxBytes);
    buffer = Buffer.alloc(toRead);
    if (toRead > 0) {
      await handle.read(buffer, 0, toRead, 0);
    }
    allLines = splitReadLines(buffer.toString("utf8"));
  } finally {
    await handle.close();
  }
  const total = allLines.length;
  const { startIndex, limit } = resolveRange(total, args.offset, args.limit);
  const sliced = allLines.slice(startIndex, startIndex + limit);
  const body = args.lineNumbers ? sliced.map((line, idx) => formatNumberedLine(startIndex + idx + 1, line)).join("\n") : sliced.join("\n");
  const readBytes = Math.min(size, args.maxBytes);
  const fileBytesTruncated = size > args.maxBytes;
  const linesTruncated = startIndex + sliced.length < total;
  return compressToolResult(
    {
      tool: "os.fs.read",
      status: "ok",
      output: body,
      details: {
        path: absolute,
        size,
        truncated: fileBytesTruncated || linesTruncated,
        bytesRead: readBytes,
        totalLines: total,
        startLine: total === 0 ? 0 : startIndex + 1,
        endLine: startIndex + sliced.length,
        returnedLines: sliced.length,
        // A read that returned nothing (empty file, or an offset past the
        // end) reports an empty 0/0 span rather than a range it did not
        // return — the detector must never credit coverage for lines the
        // model never saw.
        [READ_COVERAGE_DETAIL_KEY]: coverage(canonical, buffer, args, {
          startLine: sliced.length === 0 ? 0 : startIndex + 1,
          endLine: sliced.length === 0 ? 0 : startIndex + sliced.length,
          totalLines: total,
          // Deliberately NOT `truncated` from the details above: that one
          // also fires when the requested window merely ended before the
          // end of the readable prefix, which another offset can still
          // reach. The detector asks a narrower question — is there
          // content no range of this call could return? — and only the
          // byte cap makes that true.
          truncated: fileBytesTruncated
        })
      }
    },
    { maxSummaryLength: args.maxBytes, maxTailLines: 500 }
  );
}
function coverage(canonical, bytesRead, args, span) {
  return {
    path: canonical,
    contentHash: hashReadContent(bytesRead),
    numbered: args.lineNumbers,
    ...span
  };
}
function resolveRange(total, offset, limit) {
  if (total === 0) return { startIndex: 0, limit: 0 };
  let startIndex;
  if (offset === void 0) {
    startIndex = 0;
  } else if (offset < 0) {
    startIndex = Math.max(0, total + offset);
  } else if (offset === 0) {
    startIndex = 0;
  } else {
    startIndex = Math.min(total, offset - 1);
  }
  const effectiveLimit = limit === void 0 ? total - startIndex : Math.min(limit, total - startIndex);
  return { startIndex, limit: Math.max(0, effectiveLimit) };
}
function prefixLineNumbers(text, firstLineNumber) {
  const lines = text.split(/\r?\n/);
  return lines.map((line, idx) => formatNumberedLine(firstLineNumber + idx, line)).join("\n");
}
function formatNumberedLine(lineNumber, content) {
  return `${String(lineNumber).padStart(6, " ")}|${content}`;
}
export {
  osFsReadTool
};
