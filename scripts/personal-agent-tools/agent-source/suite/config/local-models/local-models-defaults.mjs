import { DEFAULT_DOWNLOAD_CONNECTIONS } from "../../local-llm/downloads/download-settings.mjs";
import { DEFAULT_HF_ENDPOINT } from "../../local-llm/catalog/huggingface-endpoint.mjs";
const DEFAULT_EXTERNAL_LLAMA_URL = "http://127.0.0.1:9931";
const LEGACY_EXTERNAL_LLAMA_URL = "http://127.0.0.1:8080";
function createLocalModelsDefaults() {
  return {
    url: DEFAULT_EXTERNAL_LLAMA_URL,
    mode: "external",
    completionMaxTokens: 16384,
    useServerTemplate: "auto",
    thinking: "auto",
    reasoningBudgetTokens: 0,
    drySampler: false,
    managed: {
      engine: "atomic-core",
      modelId: null,
      port: 19091,
      dataDirOverride: null,
      autoUpdate: true,
      stopOnExit: true,
      autoRestart: true,
      device: "auto",
      backendVariant: "auto",
      coreBackendVariant: "auto",
      contextSize: 0,
      tensorSplit: [],
      parallel: "auto",
      swaFull: "auto"
    },
    embeddings: {
      enabled: false,
      modelId: null,
      port: 19092,
      url: "http://127.0.0.1:19092"
    },
    download: {
      connections: DEFAULT_DOWNLOAD_CONNECTIONS,
      hfEndpoint: DEFAULT_HF_ENDPOINT
    },
    customModels: []
  };
}
export {
  DEFAULT_EXTERNAL_LLAMA_URL,
  LEGACY_EXTERNAL_LLAMA_URL,
  createLocalModelsDefaults
};
