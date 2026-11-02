const GIT_CREDENTIAL_ENV = "ATOMIC_AGENT_GIT_CREDENTIAL";
const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
const GITHUB_CREDENTIAL_KEY = "credential.https://github.com.helper";
const INLINE_HELPER = `!f() { [ "$1" = get ] || exit 0; echo username=x-access-token; echo "password=$${GIT_CREDENTIAL_ENV}"; }; f`;
function buildCredentialInjection(token) {
  const trimmed = token?.trim();
  if (!trimmed) return { args: [], env: {} };
  return {
    args: [
      // An empty value resets the helper list for this URL so a stale
      // keychain entry cannot answer for github.com with another identity.
      "-c",
      `${GITHUB_CREDENTIAL_KEY}=`,
      "-c",
      `${GITHUB_CREDENTIAL_KEY}=${INLINE_HELPER}`
    ],
    env: { [GIT_CREDENTIAL_ENV]: trimmed }
  };
}
function readGithubToken(env = process.env) {
  const raw = env[GITHUB_TOKEN_ENV]?.trim();
  return raw ? raw : void 0;
}
function hasEmbeddedUserinfo(url) {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url.trim());
  if (!match) return false;
  return match[2].includes("@");
}
function redactSecret(text, secret) {
  const trimmed = secret?.trim();
  if (!trimmed || text.length === 0) return text;
  return text.split(trimmed).join("***");
}
function sshBatchEnv(env = process.env) {
  if (env.GIT_SSH_COMMAND) return {};
  return { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}
export {
  GITHUB_TOKEN_ENV,
  GIT_CREDENTIAL_ENV,
  buildCredentialInjection,
  hasEmbeddedUserinfo,
  readGithubToken,
  redactSecret,
  sshBatchEnv
};
