const DEFAULT_HF_ENDPOINT = "https://huggingface.co";
const CANONICAL_HOSTS = [
  "https://huggingface.co",
  "https://hf.co",
  "https://www.huggingface.co"
];
let configuredEndpoint = DEFAULT_HF_ENDPOINT;
function normalizeHuggingFaceEndpoint(raw) {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
function setDefaultHuggingFaceEndpoint(endpoint) {
  configuredEndpoint = normalizeHuggingFaceEndpoint(endpoint) ?? DEFAULT_HF_ENDPOINT;
}
function resolveHuggingFaceEndpoint() {
  const env = process.env.HF_ENDPOINT;
  if (env) {
    const normalized = normalizeHuggingFaceEndpoint(env);
    if (normalized) return normalized;
  }
  return configuredEndpoint;
}
function isHuggingFaceUrl(url) {
  const endpoint = resolveHuggingFaceEndpoint();
  return CANONICAL_HOSTS.some((h) => url.startsWith(`${h}/`)) || url.startsWith(`${endpoint}/`);
}
function rewriteHuggingFaceUrl(url) {
  const endpoint = resolveHuggingFaceEndpoint();
  if (endpoint === DEFAULT_HF_ENDPOINT) return url;
  for (const host of CANONICAL_HOSTS) {
    if (url.startsWith(`${host}/`))
      return `${endpoint}${url.slice(host.length)}`;
  }
  return url;
}
function huggingFaceEndpointHost() {
  try {
    return new URL(resolveHuggingFaceEndpoint()).host;
  } catch {
    return "huggingface.co";
  }
}
export {
  DEFAULT_HF_ENDPOINT,
  huggingFaceEndpointHost,
  isHuggingFaceUrl,
  normalizeHuggingFaceEndpoint,
  resolveHuggingFaceEndpoint,
  rewriteHuggingFaceUrl,
  setDefaultHuggingFaceEndpoint
};
