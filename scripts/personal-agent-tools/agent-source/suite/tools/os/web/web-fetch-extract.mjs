import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { marked } from "marked";
import TurndownService from "turndown";
import { convertHtmlToText, looksLikeHtml } from "./html-to-text.mjs";
let turndown = null;
function htmlToMarkdown(html) {
  turndown ??= new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-"
  });
  return turndown.turndown(html).trim();
}
function markdownToPlain(markdown) {
  const html = marked.parse(markdown, { async: false });
  return convertHtmlToText(html);
}
function stripScriptStyle(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}
function tryReadability(html, url, mode) {
  try {
    const { document } = parseHTML(html);
    try {
      document.baseURI = url;
    } catch {
    }
    const reader = new Readability(
      document,
      { charThreshold: 0 }
    );
    const parsed = reader.parse();
    if (!parsed?.content) return null;
    const title = parsed.title || void 0;
    if (mode === "text") {
      const text = (parsed.textContent ?? "").replace(/[ \t]+\n/g, "\n").trim();
      return text ? { text, title } : null;
    }
    const md = htmlToMarkdown(parsed.content);
    return md ? { text: md, title } : null;
  } catch {
    return null;
  }
}
function extractWebContent(params) {
  const { body, contentType, url, mode } = params;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.split(";")[0]?.trim() === "text/markdown") {
    return {
      text: mode === "text" ? markdownToPlain(body) : body.trim(),
      extractor: "cf-markdown"
    };
  }
  if (looksLikeHtml(contentType, body)) {
    const readable = tryReadability(body, url, mode);
    if (readable) {
      return { ...readable, extractor: "readability" };
    }
    const stripped = stripScriptStyle(body);
    return {
      text: mode === "markdown" ? htmlToMarkdown(stripped) : convertHtmlToText(stripped),
      extractor: "basic"
    };
  }
  return { text: body.trim(), extractor: "raw" };
}
export {
  extractWebContent
};
