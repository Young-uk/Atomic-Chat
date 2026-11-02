import type { AtomicAgentConfig } from "../../../../config/index.mjs";
import { createBraveProvider } from "./brave-provider.mjs";
import { createDuckDuckGoProvider } from "./duckduckgo-provider.mjs";
import { createExaProvider } from "./exa-provider.mjs";
import { createSearxngProvider } from "./searxng-provider.mjs";
import type {
  WebSearchHttpDeps,
  WebSearchProvider,
  WebSearchProviderName,
} from "../web-search-provider.mjs";

export function resolveWebSearchProvider(
  config: Pick<AtomicAgentConfig, "web">,
  deps: WebSearchHttpDeps = {},
): WebSearchProvider {
  return resolveProviderByName(config.web.search.provider, config, deps);
}

/**
 * Build a single provider instance by name. Used by the orchestrator to
 * materialise every link of the fallback chain from the same config block.
 */
export function resolveProviderByName(
  name: WebSearchProviderName,
  config: Pick<AtomicAgentConfig, "web">,
  deps: WebSearchHttpDeps = {},
): WebSearchProvider {
  const search = config.web.search;
  switch (name) {
    case "duckduckgo":
      return createDuckDuckGoProvider(deps);
    case "searxng":
      return createSearxngProvider(search.searxng, deps);
    case "exa":
      return createExaProvider(search.exa, deps);
    case "brave":
      return createBraveProvider(search.brave, deps);
  }
}
