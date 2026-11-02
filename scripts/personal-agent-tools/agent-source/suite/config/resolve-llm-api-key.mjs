function resolveLlmProviderApiKey(entry) {
  if (entry.apiKey && entry.apiKey.length > 0) {
    return entry.apiKey;
  }
  if (entry.apiKeyEnvVar && entry.apiKeyEnvVar.length > 0) {
    const key = process.env[entry.apiKeyEnvVar];
    return key && key.length > 0 ? key : void 0;
  }
  if (entry.kind === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    return key && key.length > 0 ? key : void 0;
  }
  if (entry.kind === "aimlapi") {
    const key = process.env.AIMLAPI_API_KEY;
    return key && key.length > 0 ? key : void 0;
  }
  if (entry.kind === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    return key && key.length > 0 ? key : void 0;
  }
  if (entry.kind === "openai-compatible" || entry.kind === "qwen-openai-compatible") {
    const key = process.env.OPENAI_COMPAT_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ATOMIC_AGENT_OPENAI_API_KEY;
    return key && key.length > 0 ? key : void 0;
  }
  return void 0;
}
export {
  resolveLlmProviderApiKey
};
