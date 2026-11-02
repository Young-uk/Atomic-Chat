const HTTPS_OR_SSH = /^(?:https?|ssh|git):\/\/(?:[^@/:]+@)?(?:ssh\.)?github\.com(?::\d{1,5})?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SCP_LIKE = /^(?:[^@/:]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
function parseGithubRemote(url) {
  const trimmed = url.trim();
  const m = HTTPS_OR_SSH.exec(trimmed) ?? SCP_LIKE.exec(trimmed);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}
function parseRepoSlug(raw) {
  const trimmed = raw.trim();
  const fromUrl = parseGithubRemote(trimmed);
  if (fromUrl) return fromUrl;
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(
    trimmed
  );
  if (!m || !m[1] || !m[2]) return null;
  return { owner: m[1], repo: m[2] };
}
function formatRepoSlug(ref) {
  return `${ref.owner}/${ref.repo}`;
}
function isGithubRemote(url) {
  return parseGithubRemote(url) !== null;
}
function isGithubHttpsRemote(url) {
  return /^https?:\/\//i.test(url.trim()) && parseGithubRemote(url) !== null;
}
export {
  formatRepoSlug,
  isGithubHttpsRemote,
  isGithubRemote,
  parseGithubRemote,
  parseRepoSlug
};
