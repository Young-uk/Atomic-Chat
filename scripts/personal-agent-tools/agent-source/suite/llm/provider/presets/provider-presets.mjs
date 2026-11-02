const PROVIDER_PRESETS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    // The one preset that is not Bearer-authenticated. `api.anthropic.com`
    // reads `Authorization: Bearer` as an OAuth token and answers
    // "Invalid bearer token" to an `sk-ant-…` API key on every path,
    // including `/v1/models`; the key only ever authenticates as
    // `x-api-key`. `anthropic-version` is mandatory on every request and
    // is the header the API dates its wire format by — pinned, not
    // floating, so a future default cannot silently reshape responses.
    apiKeyHeader: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
    note: "Claude models through Anthropic's OpenAI-compatible endpoint"
  },
  {
    id: "atomic-chat",
    label: "Atomic Chat (local)",
    // The desktop app's Local API Server binds 127.0.0.1:1337 under `/v1`
    // and checks a key only when one is set in its settings (empty by
    // default). 127.0.0.1, not localhost: that is the address it binds.
    baseUrl: "http://127.0.0.1:1337",
    envVar: "ATOMIC_CHAT_API_KEY",
    local: true,
    note: "the Local API Server Atomic Chat runs on your machine; no API key needed"
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai",
    envVar: "CEREBRAS_API_KEY",
    note: "high-throughput inference"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    envVar: "DEEPSEEK_API_KEY",
    note: "DeepSeek models direct from the vendor"
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference",
    envVar: "FIREWORKS_API_KEY",
    note: "open-weight models, function calling"
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai",
    envVar: "GROQ_API_KEY",
    note: "very fast inference on open-weight models"
  },
  {
    id: "hyperbolic",
    label: "Hyperbolic",
    baseUrl: "https://api.hyperbolic.xyz",
    envVar: "HYPERBOLIC_API_KEY",
    note: "open-weight models on rented GPUs"
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234",
    envVar: "LMSTUDIO_API_KEY",
    local: true,
    note: "the server LM Studio runs on your machine; no API key needed"
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai",
    envVar: "MISTRAL_API_KEY",
    note: "Mistral models direct from the vendor"
  },
  {
    id: "moonshot",
    label: "Moonshot AI (Kimi)",
    baseUrl: "https://api.moonshot.ai",
    envVar: "MOONSHOT_API_KEY",
    note: "Kimi models direct from the vendor"
  },
  {
    id: "nous",
    label: "Nous Research",
    baseUrl: "https://inference-api.nousresearch.com",
    envVar: "NOUS_API_KEY",
    listsModelsWithoutKey: true,
    note: "open-weight models, 350+ ids listed without a key"
  },
  {
    id: "novita",
    label: "Novita AI",
    baseUrl: "https://api.novita.ai/openai",
    envVar: "NOVITA_API_KEY",
    listsModelsWithoutKey: true,
    note: "hosted open-weight catalog, models listed without a key"
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434",
    envVar: "OLLAMA_API_KEY",
    local: true,
    note: "the server `ollama serve` runs on your machine; no API key needed"
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com",
    envVar: "OLLAMA_CLOUD_API_KEY",
    listsModelsWithoutKey: true,
    // Known upstream quirk (issue #283): Ollama's serving layer corrupts
    // literal thinking-tag strings (`<think>`/`</think>` and variants)
    // that appear inside message content — silently dropping or mangling
    // them (ollama/ollama#17248, #17617). atomic-agent no longer injects
    // a reasoning prefill into chat-transport prompts, so its own
    // requests are clean, but user text or tool output that happens to
    // contain those literal strings can still be altered server-side
    // until Ollama fixes it. Direct vendor APIs are unaffected.
    note: "hosted Ollama, models listed without a key"
  },
  {
    id: "perplexity",
    label: "Perplexity",
    // Chat is `/chat/completions` here, not `/v1/...`: see openai-chat-path.ts.
    baseUrl: "https://api.perplexity.ai",
    envVar: "PERPLEXITY_API_KEY",
    note: "Sonar models with live web grounding"
  },
  {
    id: "dashscope",
    label: "Qwen (DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    envVar: "DASHSCOPE_API_KEY",
    note: "Qwen models direct from Alibaba Cloud (international endpoint)"
  },
  {
    id: "sambanova",
    label: "SambaNova",
    baseUrl: "https://api.sambanova.ai",
    envVar: "SAMBANOVA_API_KEY",
    listsModelsWithoutKey: true,
    note: "open-weight models on custom silicon; models listed without a key"
  },
  {
    id: "sarvam",
    label: "Sarvam",
    baseUrl: "https://api.sarvam.ai",
    envVar: "SARVAM_API_KEY",
    listsModelsWithoutKey: true,
    note: "Sarvam AI models, OpenAI-compatible; models listed without a key"
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz",
    envVar: "TOGETHER_API_KEY",
    note: "broad open-weight catalog"
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai",
    envVar: "XAI_API_KEY",
    note: "Grok models direct from the vendor"
  }
];
function findProviderPreset(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
function presetForEntryId(entryId) {
  const direct = findProviderPreset(entryId);
  if (direct) return direct;
  const suffixed = /^(.+)-\d+$/.exec(entryId);
  return suffixed ? findProviderPreset(suffixed[1]) : void 0;
}
function suggestPresetEntryId(preset, taken) {
  if (!taken.includes(preset.id)) return preset.id;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${preset.id}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${preset.id}-${Date.now()}`;
}
export {
  PROVIDER_PRESETS,
  findProviderPreset,
  presetForEntryId,
  suggestPresetEntryId
};
