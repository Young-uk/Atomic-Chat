import { createBraveProvider } from "./brave-provider.mjs";
import { createDuckDuckGoProvider } from "./duckduckgo-provider.mjs";
import { createExaProvider } from "./exa-provider.mjs";
import { createSearxngProvider } from "./searxng-provider.mjs";
function resolveWebSearchProvider(config, deps = {}) {
  return resolveProviderByName(config.web.search.provider, config, deps);
}
function resolveProviderByName(name, config, deps = {}) {
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
export {
  resolveProviderByName,
  resolveWebSearchProvider
};
