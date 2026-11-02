import { assertProviderStatus } from "./assert-provider-status.mjs";
import { searchHttp } from "../transport/search-http.mjs";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
function createBraveProvider(config, deps = {}) {
  return {
    name: "brave",
    async search(options) {
      const apiKey = process.env[config.apiKeyEnv]?.trim();
      if (!apiKey) {
        throw new Error(
          `Brave search requires ${config.apiKeyEnv} in the process environment.`
        );
      }
      const url = new URL(BRAVE_SEARCH_URL);
      url.searchParams.set("q", options.query);
      url.searchParams.set("count", String(options.maxResults));
      const response = await searchHttp({
        url: url.toString(),
        timeoutMs: options.timeoutMs,
        cwd: options.cwd,
        signal: options.signal,
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey
        },
        runCommand: deps.runCommand,
        lookup: deps.lookup
      });
      assertProviderStatus(response, "brave", "Brave search");
      return parseBraveJson(response.body, options.maxResults);
    }
  };
}
function parseBraveJson(body, maxResults) {
  const parsed = JSON.parse(body);
  const rawResults = parsed.web?.results;
  if (!Array.isArray(rawResults)) return [];
  const results = [];
  for (const raw of rawResults) {
    if (typeof raw.title !== "string" || typeof raw.url !== "string") continue;
    results.push({
      title: raw.title.trim(),
      url: raw.url.trim(),
      snippet: typeof raw.description === "string" ? raw.description.trim() : "",
      ...typeof raw.age === "string" ? { published: raw.age.trim() } : {}
    });
    if (results.length >= maxResults) break;
  }
  return results;
}
export {
  createBraveProvider,
  parseBraveJson
};
