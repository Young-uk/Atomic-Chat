import { loadConfig } from "./load-config.mjs";
let cachedConfig = null;
function getConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
function resetConfigCache() {
  cachedConfig = null;
}
export {
  getConfig,
  resetConfigCache
};
