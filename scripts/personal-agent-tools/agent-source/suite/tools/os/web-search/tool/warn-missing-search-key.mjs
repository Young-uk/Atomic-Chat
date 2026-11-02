const KEY_REQUIRED_PROVIDERS = /* @__PURE__ */ new Set(["brave"]);
function checkMissingSearchKey(input) {
  const search = input.config.web.search;
  if (!search.enabled) return null;
  const provider = search.provider;
  if (!KEY_REQUIRED_PROVIDERS.has(provider)) return null;
  const apiKeyEnv = search.brave.apiKeyEnv;
  const key = input.env[apiKeyEnv]?.trim();
  if (typeof key === "string" && key.length > 0) return null;
  const fallback = search.fallback.filter((name) => name !== provider);
  return {
    provider,
    apiKeyEnv,
    fallback,
    message: buildMessage(provider, apiKeyEnv, fallback)
  };
}
function buildMessage(provider, apiKeyEnv, fallback) {
  const destination = fallback.length > 0 ? fallback.join(", ") : "no other provider";
  return `web.search: provider "${provider}" is configured but ${apiKeyEnv} is not set, so it is skipped entirely \u2014 every search goes to ${destination}. Set ${apiKeyEnv} to use it.`;
}
export {
  checkMissingSearchKey
};
