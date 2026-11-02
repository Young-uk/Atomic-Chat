import { assertProviderStatus } from "./assert-provider-status.mjs";
import { searchHttp } from "../transport/search-http.mjs";
function createSearxngProvider(config, deps = {}) {
  return {
    name: "searxng",
    async search(options) {
      if (!config.instanceUrl) {
        throw new Error(
          "SearXNG search requires web.search.searxng.instanceUrl in config."
        );
      }
      const url = new URL("/search", config.instanceUrl);
      url.searchParams.set("q", options.query);
      url.searchParams.set("format", "json");
      const response = await searchHttp({
        url: url.toString(),
        timeoutMs: options.timeoutMs,
        cwd: options.cwd,
        signal: options.signal,
        headers: { Accept: "application/json" },
        runCommand: deps.runCommand,
        lookup: deps.lookup
      });
      assertProviderStatus(response, "searxng", "SearXNG");
      return parseSearxngJson(response.body, options.maxResults);
    }
  };
}
function parseSearxngJson(body, maxResults) {
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed.results)) return [];
  const results = [];
  for (const raw of parsed.results) {
    if (typeof raw.title !== "string" || typeof raw.url !== "string") continue;
    results.push({
      title: raw.title.trim(),
      url: raw.url.trim(),
      snippet: typeof raw.content === "string" ? raw.content.trim() : "",
      ...typeof raw.publishedDate === "string" ? { published: raw.publishedDate.trim() } : {}
    });
    if (results.length >= maxResults) break;
  }
  return results;
}
export {
  createSearxngProvider,
  parseSearxngJson
};
