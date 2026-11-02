import { convert as htmlToTextConvert } from "html-to-text";
const HTML_BODY_SNIFF_PREFIXES = ["<!doctype html", "<html", "<?xml", "<rss"];
function looksLikeHtml(contentType, body) {
  const ct = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "application/xml" || ct === "text/xml") {
    return true;
  }
  if (ct.length > 0 && ct !== "application/octet-stream" && ct !== "text/plain") {
    return false;
  }
  const head = body.trimStart().slice(0, 32).toLowerCase();
  return HTML_BODY_SNIFF_PREFIXES.some((prefix) => head.startsWith(prefix));
}
function convertHtmlToText(html) {
  return htmlToTextConvert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
      { selector: "head", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" }
    ]
  }).trim();
}
export {
  convertHtmlToText,
  looksLikeHtml
};
