import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { compressToolResult } from "../../../compressor/result-compressor.mjs";
import { resolveUserPath } from "../expand-home.mjs";
import { DOCUMENT_FORMATS } from "./extractors/extractor-types.mjs";
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 50;
function buildOsFsReadDocumentTool(options = {}) {
  return {
    name: "os.fs.read_document",
    description: "Extract plain text (with light structure markers) from PDF, DOCX, DOC (legacy), XLSX, RTF, ODT, PPTX, and plain-text files. NOT for source code \u2014 read code with os.fs.read, which pages with offset/limit. Auto-detects format by extension; override with `format`, one of: pdf, docx, doc, xlsx, rtf, odt, pptx, plain. Read-only, no approval required.",
    readonly: true,
    async run(rawArgs, ctx) {
      const args = await parseArgs(rawArgs, ctx.workingDir);
      const extractor = await resolveExtractor(args.format, options);
      const data = await readFile(args.absolute);
      const input = {
        data,
        sourcePath: args.absolute,
        pagesFrom: args.pagesFrom,
        pagesTo: args.pagesTo,
        maxPages: args.maxPages ?? DEFAULT_MAX_PAGES,
        sheets: args.sheets,
        pageSeparators: args.pageSeparators,
        includeTables: args.includeTables
      };
      const result = await extractor(input);
      const { text, bytesTruncated } = capText(result.text, args.maxBytes);
      const details = {
        path: args.absolute,
        format: result.format,
        truncated: bytesTruncated,
        warnings: result.warnings
      };
      if (result.pageCount !== void 0) details.pageCount = result.pageCount;
      if (result.sheetCount !== void 0)
        details.sheetCount = result.sheetCount;
      if (result.slideCount !== void 0)
        details.slideCount = result.slideCount;
      if (result.pagesExtracted !== void 0) {
        details.pagesExtracted = result.pagesExtracted;
      }
      return compressToolResult(
        {
          tool: "os.fs.read_document",
          status: "ok",
          output: text,
          details
        },
        { maxSummaryLength: args.maxBytes, maxTailLines: 5e3 }
      );
    }
  };
}
async function parseArgs(rawArgs, workingDir) {
  const path = rawArgs.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("os.fs.read_document: `path` must be a non-empty string");
  }
  const absolute = resolveUserPath(path, workingDir);
  const info = await stat(absolute);
  if (!info.isFile()) {
    throw new Error(`os.fs.read_document: ${absolute} is not a regular file`);
  }
  const format = detectFormat(absolute, rawArgs.format);
  const maxBytes = parsePositiveInt(
    rawArgs.maxBytes,
    DEFAULT_MAX_BYTES,
    "maxBytes"
  );
  const maxPages = parseOptionalPositiveInt(rawArgs.maxPages, "maxPages");
  const pagesFrom = parseOptionalPositiveInt(rawArgs.pagesFrom, "pagesFrom");
  const pagesTo = parseOptionalPositiveInt(rawArgs.pagesTo, "pagesTo");
  if (pagesFrom !== void 0 && pagesTo !== void 0 && pagesFrom > pagesTo) {
    throw new Error("os.fs.read_document: pagesFrom must be <= pagesTo");
  }
  const sheets = parseSheetsArg(rawArgs.sheets);
  const pageSeparators = rawArgs.pageSeparators !== false;
  const includeTables = rawArgs.includeTables !== false;
  return {
    path,
    absolute,
    format,
    maxBytes,
    maxPages,
    pagesFrom,
    pagesTo,
    sheets,
    pageSeparators,
    includeTables
  };
}
function parsePositiveInt(raw, fallback, field) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `os.fs.read_document: \`${field}\` must be a positive number`
    );
  }
  return Math.floor(raw);
}
function parseOptionalPositiveInt(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `os.fs.read_document: \`${field}\` must be a positive number`
    );
  }
  return Math.floor(raw);
}
function parseSheetsArg(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (!Array.isArray(raw)) {
    throw new Error(
      "os.fs.read_document: `sheets` must be an array of strings or 1-indexed numbers"
    );
  }
  const out = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      out.push(entry);
    } else if (typeof entry === "number" && Number.isFinite(entry) && entry >= 1) {
      out.push(Math.floor(entry));
    } else {
      throw new Error(
        `os.fs.read_document: invalid sheet identifier ${JSON.stringify(entry)}`
      );
    }
  }
  return out;
}
const SOURCE_LIKE_EXTENSIONS = /* @__PURE__ */ new Set([
  "bash",
  "c",
  "cc",
  "cfg",
  "cjs",
  "clj",
  "conf",
  "cpp",
  "cs",
  "css",
  "cxx",
  "dart",
  "env",
  "erl",
  "ex",
  "exs",
  "fish",
  "go",
  "gradle",
  "h",
  "hh",
  "hpp",
  "hs",
  "ini",
  "ipynb",
  "java",
  "js",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lua",
  "m",
  "mjs",
  "mm",
  "php",
  "pl",
  "pm",
  "properties",
  "proto",
  "ps1",
  "py",
  "pyi",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "tf",
  "toml",
  "ts",
  "tsx",
  "vue",
  "zsh"
]);
function detectFormat(absolute, override) {
  if (typeof override === "string" && override.length > 0) {
    const norm = override.toLowerCase();
    if (isKnownFormat(norm)) return norm;
    throw new Error(
      `os.fs.read_document: unknown format override ${JSON.stringify(override)} \u2014 expected one of ${DOCUMENT_FORMATS.join(", ")}; for source or text files use os.fs.read`
    );
  }
  const ext = extname(absolute).toLowerCase().replace(/^\./, "");
  switch (ext) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "doc":
      return "doc";
    case "xlsx":
      return "xlsx";
    case "rtf":
      return "rtf";
    case "odt":
      return "odt";
    case "pptx":
      return "pptx";
    case "":
    case "txt":
    case "md":
    case "log":
    case "csv":
    case "tsv":
    case "json":
    case "html":
    case "xml":
    case "yaml":
    case "yml":
      return "plain";
    default:
      throw new Error(
        SOURCE_LIKE_EXTENSIONS.has(ext) ? `os.fs.read_document: ".${ext}" is a source or config file \u2014 use os.fs.read instead; if you intended document extraction, retry with \`format: "plain"\`` : `os.fs.read_document: unsupported extension ".${ext}" \u2014 use os.fs.read for source or text files, or retry with an explicit format (e.g. \`format: "plain"\`)`
      );
  }
}
function isKnownFormat(value) {
  return DOCUMENT_FORMATS.includes(value);
}
async function resolveExtractor(format, options) {
  const injected = options.extractors?.[format];
  if (injected) return injected;
  switch (format) {
    case "pdf":
      return (await import("./extractors/pdf-extractor.mjs")).pdfExtractor;
    case "docx":
      return (await import("./extractors/docx-extractor.mjs")).docxExtractor;
    case "doc":
      return (await import("./extractors/doc-extractor.mjs")).docExtractor;
    case "xlsx":
      return (await import("./extractors/xlsx-extractor.mjs")).xlsxExtractor;
    case "rtf":
      return (await import("./extractors/rtf-extractor.mjs")).rtfExtractor;
    case "odt":
      return (await import("./extractors/odt-extractor.mjs")).odtExtractor;
    case "pptx":
      return (await import("./extractors/pptx-extractor.mjs")).pptxExtractor;
    case "plain":
      return (await import("./extractors/plain-text-extractor.mjs")).plainTextExtractor;
  }
}
function capText(text, maxBytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) {
    return { text, bytesTruncated: false };
  }
  const sliced = buf.subarray(0, maxBytes).toString("utf8");
  const safe = sliced.endsWith("\uFFFD") ? sliced.slice(0, -1) : sliced;
  return { text: safe, bytesTruncated: true };
}
export {
  buildOsFsReadDocumentTool
};
