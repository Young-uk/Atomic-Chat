import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { resolveUserPath } from "../os/expand-home.mjs";
import { checkCssSource } from "./check-css-syntax.mjs";
import { checkHtmlSource } from "./check-html-syntax.mjs";
import {
  checkLanguageFile,
  LANGUAGE_SYNTAX_EXTENSIONS
} from "./check-language-syntax.mjs";
import {
  checkJavaScriptFile,
  checkPythonFile,
  checkShellFile
} from "./check-script-syntax.mjs";
import { checkTypeScriptFiles } from "./check-typescript-syntax.mjs";
const VERIFY_SYNTAX_TOOL = "verify.syntax";
const VERIFY_SYNTAX_MAX_FILES = 200;
const VERIFY_SUMMARY_MAX_CHARS = 4e3;
const JS_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".cjs", ".mjs", ".json", ".jsonc"]);
const TS_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx"]);
const SHELL_EXTENSIONS = /* @__PURE__ */ new Set([".sh", ".bash"]);
function parseVerifySyntaxArgs(raw) {
  const files = raw.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("verify.syntax: `files` must be a non-empty array of paths");
  }
  if (files.length > VERIFY_SYNTAX_MAX_FILES) {
    throw new Error(
      `verify.syntax: at most ${VERIFY_SYNTAX_MAX_FILES} files per call (got ${files.length})`
    );
  }
  const out = [];
  for (const entry of files) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error("verify.syntax: every entry of `files` must be a non-empty string");
    }
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}
async function checkOne(file, absolute) {
  const ext = extname(absolute).toLowerCase();
  if (JS_EXTENSIONS.has(ext)) {
    return checkJavaScriptFile(absolute, await readFile(absolute, "utf8")).then(
      (r) => ({ ...r, file })
    );
  }
  if (ext === ".py") return { ...await checkPythonFile(absolute), file };
  if (SHELL_EXTENSIONS.has(ext)) return { ...await checkShellFile(absolute), file };
  if (ext === ".html" || ext === ".htm") {
    return { ...await checkHtmlSource(file, await readFile(absolute, "utf8")) };
  }
  if (ext === ".css") return checkCssSource(file, await readFile(absolute, "utf8"));
  if (LANGUAGE_SYNTAX_EXTENSIONS.has(ext)) {
    return { ...await checkLanguageFile(absolute, ext), file };
  }
  return {
    file,
    ok: null,
    checker: "none",
    error: `no checker for ${ext.length > 0 ? ext : "files without an extension"}`
  };
}
async function verifySyntax(files, workingDir) {
  const results = new Array(files.length);
  const typescript = [];
  for (const [index, file] of files.entries()) {
    const absolute = resolveUserPath(file, workingDir);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) {
        results[index] = { file, ok: false, checker: "none", error: "not a regular file" };
        continue;
      }
    } catch {
      results[index] = { file, ok: false, checker: "none", error: "no such file" };
      continue;
    }
    if (TS_EXTENSIONS.has(extname(absolute).toLowerCase())) {
      typescript.push({ index, file, absolute });
      continue;
    }
    results[index] = await checkOne(file, absolute);
  }
  if (typescript.length > 0) {
    const verdicts = await checkTypeScriptFiles(typescript);
    for (const [i, entry] of typescript.entries()) {
      results[entry.index] = { ...verdicts[i], file: entry.file };
    }
  }
  return report(results);
}
function report(results) {
  const failed = results.filter((r) => r.ok === false);
  const unchecked = results.filter((r) => r.ok === null);
  const passed = results.filter((r) => r.ok === true);
  const line = (r) => {
    const mark = r.ok === true ? "ok" : r.ok === false ? "FAIL" : "unchecked";
    const why = r.error === void 0 ? "" : ` \u2014 ${r.error}`;
    const warn = r.warning === void 0 ? "" : ` \u26A0 ${r.warning}`;
    return `${mark} ${r.file} [${r.checker}]${why}${warn}`;
  };
  const missingByExt = /* @__PURE__ */ new Map();
  for (const r of unchecked) {
    if (r.checker !== "none" || !r.error?.startsWith("no checker for ")) continue;
    const ext = r.error.slice("no checker for ".length);
    missingByExt.set(ext, (missingByExt.get(ext) ?? 0) + 1);
  }
  const head = `verify.syntax: ${passed.length} ok, ${failed.length} failed, ${unchecked.length} unchecked` + (unchecked.length > 0 ? " (unchecked files do not count as passing)" : "");
  const lines = [
    head,
    ...[...missingByExt].map(([ext, n]) => `no checker for ${ext} (${n} file${n === 1 ? "" : "s"})`),
    ...failed.map(line),
    ...unchecked.map(line),
    ...passed.map(line)
  ];
  let summary = lines.join("\n");
  if (summary.length > VERIFY_SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, VERIFY_SUMMARY_MAX_CHARS - 12)}
\u2026 [clipped]`;
  }
  return { results, passed: passed.length, failed: failed.length, unchecked: unchecked.length, summary };
}
const verifySyntaxTool = {
  name: VERIFY_SYNTAX_TOOL,
  description: "Syntax-check files, one checker per file by extension: .js/.cjs/.mjs/.json in-process (then node --check), .ts/.tsx via the project's tsc --noEmit, .py via python3, .sh/.bash via bash -n, .html inline <script> blocks (plus a warning for content after </html>), .css brace balance, .go/.rb/.php/.lua/.zsh via gofmt -l -e, ruby -c, php -l, luac -p, zsh -n when that tool is installed. Read-only, writes nothing. A file with no checker is reported as unchecked, never as passing.",
  readonly: true,
  async run(rawArgs, ctx) {
    const files = parseVerifySyntaxArgs(rawArgs);
    const out = await verifySyntax(files, ctx.workingDir);
    return {
      tool: VERIFY_SYNTAX_TOOL,
      status: out.failed > 0 ? "error" : "ok",
      summary: out.summary,
      details: {
        results: out.results,
        passed: out.passed,
        failed: out.failed,
        unchecked: out.unchecked
      },
      truncated: out.summary.endsWith("[clipped]")
    };
  }
};
export {
  VERIFY_SUMMARY_MAX_CHARS,
  VERIFY_SYNTAX_MAX_FILES,
  VERIFY_SYNTAX_TOOL,
  parseVerifySyntaxArgs,
  verifySyntax,
  verifySyntaxTool
};
