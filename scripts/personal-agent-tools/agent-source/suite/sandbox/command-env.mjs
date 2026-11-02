const KNOWN_SECRET_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "CEREBRAS_API_KEY",
  "PERPLEXITY_API_KEY",
  "MOONSHOT_API_KEY",
  "DASHSCOPE_API_KEY",
  "NOVITA_API_KEY",
  "HYPERBOLIC_API_KEY",
  "SAMBANOVA_API_KEY",
  "SARVAM_API_KEY",
  "NOUS_API_KEY",
  "AIMLAPI_API_KEY",
  "OLLAMA_API_KEY",
  "OLLAMA_CLOUD_API_KEY",
  "LMSTUDIO_API_KEY",
  "VLLM_API_KEY",
  "LLAMA_API_KEY",
  "OPENAI_COMPAT_API_KEY",
  "ATOMIC_AGENT_API_KEY",
  "ATOMIC_AGENT_LLAMA_API_KEY",
  "ATOMIC_AGENT_OPENAI_API_KEY",
  "ATOMIC_CHAT_API_KEY",
  "ATOMIC_MAIL_API_KEY",
  "EXA_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "COMPOSIO_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "DISCORD_BOT_TOKEN",
  "CLAWHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN"
];
const KNOWN = new Set(KNOWN_SECRET_ENV_VARS.map((name) => name.toUpperCase()));
const SECRET_SUBSTRINGS = [
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "PASSPHRASE",
  "CREDENTIAL",
  "APIKEY",
  "API_KEY",
  "PRIVATE_KEY",
  "ACCESS_KEY",
  "COOKIE"
];
const KEY_SEGMENTS = /* @__PURE__ */ new Set(["KEY", "KEYS"]);
const CREDENTIAL_SEGMENTS = /* @__PURE__ */ new Set(["PAT", "JWT"]);
const VAULT_SESSION = /^(BW_SESSION|OP_SESSION_.+)$/;
const NOT_SECRET = /^(PASSWORD_STORE_.+|TOKENIZERS_PARALLELISM)$/;
function isSecretEnvName(name) {
  const upper = name.toUpperCase();
  if (KNOWN.has(upper)) return true;
  if (VAULT_SESSION.test(upper)) return true;
  if (NOT_SECRET.test(upper)) return false;
  if (SECRET_SUBSTRINGS.some((part) => upper.includes(part))) return true;
  const segments = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  if (segments.at(-1) === "AUTH") return true;
  return segments.some(
    (segment) => KEY_SEGMENTS.has(segment) || CREDENTIAL_SEGMENTS.has(segment)
  );
}
function buildCommandEnv(base = process.env, passthrough = []) {
  const allowed = new Set(passthrough.map((name) => name.toUpperCase()));
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== "string") continue;
    if (isSecretEnvName(key) && !allowed.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  return env;
}
export {
  KNOWN_SECRET_ENV_VARS,
  buildCommandEnv,
  isSecretEnvName
};
