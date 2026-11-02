const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
const TOKEN_SHAPE = /^(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})$/;
function looksLikeGithubToken(raw) {
  return TOKEN_SHAPE.test(raw.trim());
}
function resolveGithubToken(explicit, env = process.env) {
  if (explicit !== void 0) return explicit;
  const raw = env[GITHUB_TOKEN_ENV];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function scrubGithubToken(message) {
  return message.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "<token>").replace(/github_pat_[A-Za-z0-9_]{40,}/g, "<token>").replace(/(AUTHORIZATION:\s*basic\s+)[A-Za-z0-9+/=]+/gi, "$1<redacted>");
}
const GITHUB_NOT_CONNECTED = "GitHub is not connected. Open the Integrations tab (or run /integrations github) and add a personal access token.";
export {
  GITHUB_NOT_CONNECTED,
  GITHUB_TOKEN_ENV,
  looksLikeGithubToken,
  resolveGithubToken,
  scrubGithubToken
};
