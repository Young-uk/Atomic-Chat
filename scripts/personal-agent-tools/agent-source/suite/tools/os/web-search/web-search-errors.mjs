class WebSearchBlockedError extends Error {
  provider;
  constructor(provider, message) {
    super(message ?? `${provider} rate-limited or returned a bot challenge`);
    this.name = "WebSearchBlockedError";
    this.provider = provider;
  }
}
class WebSearchRateLimitedError extends WebSearchBlockedError {
  /** Server-advertised wait, or `null` when it did not say. */
  retryAfterMs;
  constructor(provider, retryAfterMs = null, message) {
    super(provider, message ?? `${provider} returned HTTP 429 (rate limited)`);
    this.name = "WebSearchRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}
const EXA_GET_KEY_URL = "https://dashboard.exa.ai/api-keys";
const DEFAULT_EXA_KEY_ENV = "EXA_API_KEY";
class WebSearchUnavailableError extends WebSearchBlockedError {
  failures;
  keyRequired;
  constructor(provider, message, failures, keyRequired) {
    super(provider, message);
    this.name = "WebSearchUnavailableError";
    this.failures = failures;
    this.keyRequired = keyRequired;
  }
}
export {
  DEFAULT_EXA_KEY_ENV,
  EXA_GET_KEY_URL,
  WebSearchBlockedError,
  WebSearchRateLimitedError,
  WebSearchUnavailableError
};
