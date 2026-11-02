import { WebSearchRateLimitedError } from "../web-search-errors.mjs";
function assertProviderStatus(response, name, label) {
  if (response.status === 429) {
    throw new WebSearchRateLimitedError(
      name,
      response.retryAfterMs,
      `${label} returned HTTP 429 (rate limited)`
    );
  }
  if (response.status >= 400) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
}
export {
  assertProviderStatus
};
