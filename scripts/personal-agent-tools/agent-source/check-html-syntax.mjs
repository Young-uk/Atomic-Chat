import { checkJavaScriptSource } from "./check-script-syntax.mjs";
const HTML_CHECKER = "html-inline-js";
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTR = /\bsrc\s*=/i;
const TYPE_ATTR = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const JS_TYPES = /* @__PURE__ */ new Set([
  "",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
  "module"
]);
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text[i] === "\n") line += 1;
  return line;
}
function extractInlineScripts(html) {
  const scripts = [];
  let external = 0;
  let index = 0;
  for (const match of html.matchAll(SCRIPT_BLOCK)) {
    const attrs = match[1] ?? "";
    const code = match[2] ?? "";
    index += 1;
    if (SRC_ATTR.test(attrs)) {
      external += 1;
      continue;
    }
    const typeMatch = attrs.match(TYPE_ATTR);
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "").trim().toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(code, attrs.length);
    scripts.push({
      index,
      line: lineOf(html, bodyOffset),
      code,
      module: type === "module"
    });
  }
  return { scripts, external };
}
function trailingContentWarning(html) {
  const close = html.toLowerCase().lastIndexOf("</html>");
  if (close === -1) return null;
  const rest = html.slice(close + "</html>".length);
  if (rest.trim().length === 0) return null;
  const head = rest.trim().replace(/\s+/g, " ").slice(0, 80);
  return `${rest.trim().length} chars of content after </html> (browsers render it as more body): "${head}"`;
}
function rebaseLine(message, blockLine) {
  return message.replace(
    /\(line (\d+)\)$/,
    (_m, n) => `(line ${blockLine + Number.parseInt(n, 10) - 1})`
  );
}
async function checkHtmlSource(file, html) {
  const { scripts, external } = extractInlineScripts(html);
  const warning = trailingContentWarning(html);
  const withWarning = (result) => warning === null ? result : { ...result, warning };
  if (scripts.length === 0) {
    const externals = external > 0 ? ` (${external} external)` : "";
    return withWarning({
      file,
      ok: null,
      checker: HTML_CHECKER,
      error: `no inline scripts to check${externals}`
    });
  }
  const failures = [];
  const unjudged = [];
  for (const script of scripts) {
    const verdict = await checkJavaScriptSource(
      `${file}#script${script.index}`,
      script.code,
      { module: script.module }
    );
    const label = `inline script #${script.index} (line ${script.line})`;
    if (verdict.ok === false) {
      failures.push(`${label}: ${rebaseLine(verdict.error ?? "syntax error", script.line)}`);
    } else if (verdict.ok === null) {
      unjudged.push(`${label}: ${verdict.error ?? "no verdict"}`);
    }
  }
  if (failures.length > 0) {
    return withWarning({
      file,
      ok: false,
      checker: HTML_CHECKER,
      error: failures.join("; ")
    });
  }
  if (unjudged.length > 0) {
    return withWarning({
      file,
      ok: null,
      checker: HTML_CHECKER,
      error: unjudged.join("; ")
    });
  }
  return withWarning({ file, ok: true, checker: HTML_CHECKER });
}
export {
  HTML_CHECKER,
  checkHtmlSource,
  extractInlineScripts,
  trailingContentWarning
};
