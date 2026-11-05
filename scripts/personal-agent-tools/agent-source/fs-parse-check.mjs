import vm from "node:vm";
import { basename, extname } from "node:path";
const OK = { kind: "ok" };
const SKIPPED = { kind: "skipped" };
const PARSE_CHECK_MAX_CHARS = 2 * 1024 * 1024;
const MANY_OCCURRENCES = 3;
const CHECKED_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".cjs", ".mjs", ".json"]);
const STRICT_JSON_FILES = /* @__PURE__ */ new Set(["package.json", "package-lock.json"]);
const CJS_WRAPPER_PARAMS = [
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname"
];
const MODULE_ONLY_ERRORS = /* @__PURE__ */ new Set([
  "Cannot use import statement outside a module",
  "Unexpected token 'export'",
  "Cannot use 'import.meta' outside a module",
  "await is only valid in async functions and the top level bodies of modules"
]);
const MODULE_SYNTAX = /^[ \t]*(?:import(?:\s+[\w$]|\s*[{*"'])|export(?:\s+[\w$]|\s*[{*]))|\bimport\.meta\b/m;
function isParseCheckedPath(path) {
  return CHECKED_EXTENSIONS.has(extname(path).toLowerCase());
}
function checkFileParses(path, content) {
  const ext = extname(path).toLowerCase();
  if (!CHECKED_EXTENSIONS.has(ext)) return SKIPPED;
  if (content.length > PARSE_CHECK_MAX_CHARS) return SKIPPED;
  const source = content.charCodeAt(0) === 65279 ? content.slice(1) : content;
  const name = basename(path);
  try {
    return ext === ".json" ? checkJson(name, source) : checkScript(name, source, ext);
  } catch {
    return SKIPPED;
  }
}
function checkJson(name, source) {
  try {
    JSON.parse(source);
    return OK;
  } catch (err) {
    if (!STRICT_JSON_FILES.has(name.toLowerCase())) {
      try {
        JSON.parse(stripJsonc(source));
        return OK;
      } catch {
      }
    }
    return { kind: "error", message: `SyntaxError: ${messageOf(err)}` };
  }
}
function checkScript(name, source, ext) {
  let error = compileError(() => new vm.Script(source, { filename: name }));
  if (error === null) return OK;
  if (error.message === "Illegal return statement") {
    error = compileError(
      () => vm.compileFunction(source, CJS_WRAPPER_PARAMS, { filename: name })
    );
    if (error === null) return OK;
  }
  if (beyondPlainScript(name, source, ext, error)) return SKIPPED;
  const line = errorLine(error, name);
  return {
    kind: "error",
    message: `SyntaxError: ${error.message}${line === null ? "" : ` (line ${line})`}`
  };
}
function beyondPlainScript(name, source, ext, error) {
  if (ext === ".mjs") return true;
  if (MODULE_ONLY_ERRORS.has(error.message)) return true;
  if (MODULE_SYNTAX.test(source)) return true;
  if (/^[ \t]*(?:for\s+await\b|await\s+using\b)/m.test(source)) return true;
  if (error.message === "Unexpected token '<'") return true;
  if (/@flow\b/.test(source.slice(0, 2048))) return true;
  if (/^\s*@/.test(errorSourceLine(error, name) ?? "")) return true;
  return false;
}
function compileError(compile) {
  try {
    compile();
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === "SyntaxError") return err;
    throw err;
  }
}
function stackLines(error, name) {
  if (typeof error.stack !== "string") return null;
  const lines = error.stack.split("\n");
  return lines[0]?.startsWith(`${name}:`) ? lines : null;
}
function errorLine(error, name) {
  const first = stackLines(error, name)?.[0];
  if (first === void 0) return null;
  const line = Number.parseInt(first.slice(name.length + 1), 10);
  return Number.isInteger(line) && line > 0 ? line : null;
}
function errorSourceLine(error, name) {
  return stackLines(error, name)?.[1] ?? null;
}
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}
function stripJsonc(source) {
  const parts = [];
  let start = 0;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '"') {
      i += 1;
      while (i < n && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (ch === "/" && source[i + 1] === "/") {
      parts.push(source.slice(start, i));
      while (i < n && source[i] !== "\n") i += 1;
      start = i;
    } else if (ch === "/" && source[i + 1] === "*") {
      parts.push(source.slice(start, i));
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      start = i;
    } else {
      i += 1;
    }
  }
  parts.push(source.slice(start));
  return parts.join("").replace(
    /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g,
    (match, str, close) => str ?? close ?? match
  );
}
export {
  MANY_OCCURRENCES,
  PARSE_CHECK_MAX_CHARS,
  checkFileParses,
  isParseCheckedPath,
  stripJsonc
};
