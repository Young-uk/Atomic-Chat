import { assertProviderStatus } from "./assert-provider-status.mjs";
import { parseHTML } from "linkedom";
import { searchHttp } from "../transport/search-http.mjs";
import { WebSearchBlockedError } from "../web-search-errors.mjs";
const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/";
const BOT_CHALLENGE_MARKERS = [
  "g-recaptcha",
  "are you a human",
  "challenge-form",
  "anomaly"
];
function createDuckDuckGoProvider(deps = {}) {
  return {
    name: "duckduckgo",
    async search(options) {
      const url = new URL(DUCKDUCKGO_HTML_URL);
      url.searchParams.set("q", options.query);
      const response = await searchHttp({
        url: url.toString(),
        timeoutMs: options.timeoutMs,
        cwd: options.cwd,
        signal: options.signal,
        headers: { Accept: "text/html,application/xhtml+xml" },
        runCommand: deps.runCommand,
        lookup: deps.lookup
      });
      assertProviderStatus(response, "duckduckgo", "DuckDuckGo");
      const results = parseDuckDuckGoHtml(response.body, options.maxResults);
      if (results.length === 0 && isBotChallenge(response.body)) {
        throw new WebSearchBlockedError("duckduckgo");
      }
      return results;
    }
  };
}
function isBotChallenge(html) {
  const lower = html.toLowerCase();
  if (lower.includes("result__a")) return false;
  return BOT_CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}
function parseDuckDuckGoHtml(html, maxResults) {
  const { document } = parseHTML(html);
  const results = [];
  const nodes = Array.from(
    document.querySelectorAll(".result")
  );
  for (const node of nodes) {
    const link = node.querySelector(".result__a");
    if (!link) continue;
    const title = cleanText(link.textContent ?? "");
    const href = normaliseDuckDuckGoHref(link.getAttribute("href"));
    if (!title || !href) continue;
    const snippet = cleanText(
      node.querySelector(".result__snippet")?.textContent ?? ""
    );
    results.push({ title, url: href, snippet });
    if (results.length >= maxResults) break;
  }
  return results;
}
function normaliseDuckDuckGoHref(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    if (redirected) return redirected;
    if (url.hostname.endsWith("duckduckgo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}
export {
  createDuckDuckGoProvider,
  isBotChallenge,
  parseDuckDuckGoHtml
};
