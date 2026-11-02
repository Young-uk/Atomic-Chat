const DEFAULT_DOWNLOAD_CONNECTIONS = 16;
const MAX_DOWNLOAD_CONNECTIONS = 64;
let configuredConnections = DEFAULT_DOWNLOAD_CONNECTIONS;
function clampDownloadConnections(n) {
  if (!Number.isFinite(n)) return DEFAULT_DOWNLOAD_CONNECTIONS;
  return Math.min(MAX_DOWNLOAD_CONNECTIONS, Math.max(1, Math.floor(n)));
}
function setDefaultDownloadConnections(n) {
  configuredConnections = clampDownloadConnections(n);
}
function resolveDownloadConnections(explicit) {
  if (explicit !== void 0) return clampDownloadConnections(explicit);
  const env = (process.env.ATOMIC_AGENT_DOWNLOAD_CONNECTIONS ?? "").trim();
  if (env) {
    const parsed = Number.parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1)
      return clampDownloadConnections(parsed);
  }
  return configuredConnections;
}
export {
  DEFAULT_DOWNLOAD_CONNECTIONS,
  MAX_DOWNLOAD_CONNECTIONS,
  clampDownloadConnections,
  resolveDownloadConnections,
  setDefaultDownloadConnections
};
