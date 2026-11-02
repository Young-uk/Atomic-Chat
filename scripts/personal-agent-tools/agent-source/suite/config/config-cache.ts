import { loadConfig } from "./load-config.mjs";
import type { AtomicAgentConfig } from "./config-schema.mjs";

let cachedConfig: AtomicAgentConfig | null = null;

export function getConfig(): AtomicAgentConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
