const LOCAL_MODELS_CATALOG = [
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B QAT GGUF",
    filename: "gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
    fileSizeGb: 4.22,
    sizeLabel: "4.2 GB",
    description: "Small and light Gemma, for 8 GB machines and up",
    recommendRank: 10,
    maxContextLength: 131072,
    contextLabel: "128K",
    minRamGb: 6,
    recommendedRamGb: 8,
    family: "gemma",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/mmproj-BF16.gguf",
    mmprojFilename: "mmproj-BF16.gguf",
    mmprojFileSizeGb: 0.99
  },
  {
    id: "gemma-4-12b",
    name: "Gemma 4 12B QAT GGUF",
    filename: "gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
    fileSizeGb: 6.72,
    sizeLabel: "6.7 GB",
    description: "Mid-size Gemma, for 12 GB machines and up",
    recommendRank: 9,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 8,
    recommendedRamGb: 12,
    family: "gemma",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF/resolve/main/mmproj-BF16.gguf",
    mmprojFilename: "mmproj-BF16.gguf",
    mmprojFileSizeGb: 0.175
  },
  {
    id: "gemma-4-26b-a4b",
    name: "Gemma 4 26B-A4B QAT GGUF",
    filename: "gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF/resolve/main/gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf",
    fileSizeGb: 14.25,
    sizeLabel: "14.2 GB",
    description: "Big Gemma that stays quick for its size, 20 GB and up",
    recommendRank: 2,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 16,
    recommendedRamGb: 20,
    family: "gemma",
    tag: "High Performance",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF/resolve/main/mmproj-BF16.gguf",
    mmprojFilename: "mmproj-BF16.gguf",
    mmprojFileSizeGb: 1.19
  },
  {
    id: "gemma-4-31b",
    name: "Gemma 4 31B QAT GGUF",
    filename: "gemma-4-31B-it-qat-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/gemma-4-31B-it-qat-GGUF/resolve/main/gemma-4-31B-it-qat-UD-Q4_K_XL.gguf",
    fileSizeGb: 17.29,
    sizeLabel: "17.3 GB",
    description: "Biggest Gemma, for 24 GB machines and up",
    recommendRank: 6,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 20,
    recommendedRamGb: 24,
    family: "gemma",
    tag: "High Performance",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/gemma-4-31B-it-qat-GGUF/resolve/main/mmproj-BF16.gguf",
    mmprojFilename: "mmproj-BF16.gguf",
    mmprojFileSizeGb: 1.2
  },
  {
    id: "qwen-3.8-27b",
    name: "Qwen 3.8 27B GGUF",
    filename: "Qwen3.8-27B-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q4_K_XL.gguf",
    fileSizeGb: 17.9,
    sizeLabel: "17.9 GB",
    description: "Newest big Qwen, for 28 GB machines and up",
    recommendRank: 4,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 20,
    recommendedRamGb: 28,
    family: "qwen",
    tag: "New",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.93
  },
  {
    id: "qwen-3.6-27b",
    name: "Qwen 3.6 27B GGUF",
    filename: "Qwen3.6-27B-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-UD-Q4_K_XL.gguf",
    fileSizeGb: 17.6,
    sizeLabel: "17.6 GB",
    description: "Big Qwen, older version, for 28 GB machines and up",
    recommendRank: 5,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 20,
    recommendedRamGb: 28,
    family: "qwen",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.93
  },
  {
    id: "qwen-3.6-35b-a3b",
    name: "Qwen 3.6 35B-A3B GGUF",
    filename: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
    fileSizeGb: 22.4,
    sizeLabel: "22.4 GB",
    description: "Big Qwen that stays quick for its size, 36 GB and up",
    recommendRank: 1,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 24,
    recommendedRamGb: 36,
    family: "qwen",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.9
  },
  /* ATO-1041: the starter model the desktop fetches on its first launch
     (not shipped in the installer, Nadya 25.10), so a first chat answers
     without a key or a long download. Never auto-recommended: no
     recommendRank, the picker's recommendation is unchanged. */
  {
    id: "qwen-3.5-2b",
    name: "Qwen 3.5 2B GGUF",
    filename: "Qwen3.5-2B-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-UD-Q4_K_XL.gguf",
    fileSizeGb: 1.34,
    sizeLabel: "1.3 GB",
    description: "Tiny starter model, ready in a minute; any machine",
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 4,
    recommendedRamGb: 6,
    family: "qwen",
    supportsVision: false
  },
  {
    id: "qwen-3.5-4b",
    name: "Qwen 3.5 4B GGUF",
    filename: "Qwen3.5-4B-Q4_K_M.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    fileSizeGb: 2.7,
    sizeLabel: "2.7 GB",
    description: "Small and quick to download, for 8 GB machines and up",
    recommendRank: 8,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 6,
    recommendedRamGb: 8,
    family: "qwen",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.67
  },
  {
    id: "qwen-3.5-9b",
    name: "Qwen 3.5 9B GGUF",
    filename: "Qwen3.5-9B-Q4_K_M.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
    fileSizeGb: 5.3,
    sizeLabel: "5.3 GB",
    description: "Everyday mid-size Qwen, for 16 GB machines and up",
    recommendRank: 7,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 10,
    recommendedRamGb: 16,
    family: "qwen",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.92
  },
  {
    id: "qwen-3.5-35b",
    name: "Qwen 3.5 35B-A3B GGUF",
    filename: "Qwen3.5-35B-A3B-Q4_K_M.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf",
    fileSizeGb: 22,
    sizeLabel: "22 GB",
    description: "Older big Qwen, for 36 GB machines and up",
    recommendRank: 3,
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 24,
    recommendedRamGb: 36,
    family: "qwen",
    tag: "High Performance",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf",
    mmprojFilename: "mmproj-F16.gguf",
    mmprojFileSizeGb: 0.9
  },
  {
    id: "nemotron-3.5-30b-a3b",
    name: "NVIDIA Nemotron 3.5 Lightning 30B-A3B GGUF",
    filename: "NVIDIA-Nemotron-3.5-Lightning-30B-A3B-AD-IQ4_NL.gguf",
    huggingFaceUrl: "https://huggingface.co/AtomicChat/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF/resolve/main/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-AD-IQ4_NL.gguf",
    fileSizeGb: 19.65,
    sizeLabel: "19.7 GB",
    description: "Big NVIDIA model, text only, for 32 GB machines and up",
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 24,
    recommendedRamGb: 32,
    family: "nemotron",
    tag: "New",
    supportsVision: false
  },
  {
    id: "muse-glimmer-30b",
    name: "Meta Muse Glimmer 30B GGUF",
    filename: "Muse-Glimmer-30B-UD-Q4_K_XL.gguf",
    huggingFaceUrl: "https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF/resolve/main/Muse-Glimmer-30B-UD-Q4_K_XL.gguf",
    fileSizeGb: 15.9,
    sizeLabel: "15.9 GB",
    // Vision is fully wired (mmproj below). The native ATEM/Harmony tool
    // format is NOT: the daemon passes `model.id` as the llama-server
    // alias (`daemon-lifecycle.ts`), and `muse-glimmer-30b` matches no
    // alias hint in `selectBaseProfile`, so this resolves to
    // `plain-instruct` and tool calls go through the generic GBNF array
    // grammar. Pinned by `models-catalog.test.ts`; reword only when a
    // native profile actually lands.
    description: "Big Meta model, generic tool calling, 32 GB and up",
    maxContextLength: 131072,
    contextLabel: "128K",
    minRamGb: 20,
    recommendedRamGb: 32,
    family: "muse",
    tag: "New",
    supportsVision: true,
    mmprojUrl: "https://huggingface.co/unsloth/Muse-Glimmer-30B-GGUF/resolve/main/mmproj-Muse-Glimmer-30B-Q8_0.gguf",
    mmprojFilename: "mmproj-Muse-Glimmer-30B-Q8_0.gguf",
    mmprojFileSizeGb: 2.05
  },
  {
    // Kept LAST on purpose: the Manage panel draws the catalog in array
    // order and the onboarding picker pins uncensored entries to the
    // bottom — an entry inserted above would put reduced-refusal weights
    // ahead of the safe defaults.
    //
    // The `noMTP` file is deliberate: the repo's fused quants carry an
    // inline MTP (speculative-decoding) head, while noMTP is a standard
    // GGUF that any llama-server loads — and the daemon has no
    // `--model-draft` wiring to use an MTP head anyway.
    id: "qwen-3.8-27b-uncensored",
    // Spelt like the other Qwen entries ("Qwen 3.8 27B GGUF"); the
    // desktop picker uses the same name, description and note.
    name: "Qwen 3.8 27B Uncensored GGUF",
    filename: "Qwen3.8-27B-Uncensored-noMTP-Q4_K_M.gguf",
    huggingFaceUrl: "https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/Qwen3.8-27B-Uncensored-noMTP-Q4_K_M.gguf",
    fileSizeGb: 16.5,
    sizeLabel: "16.5 GB",
    description: "Reduced-refusal Qwen 3.8 27B (abliterated)",
    note: "Fewer safety refusals: it may answer requests other models decline.",
    maxContextLength: 262144,
    contextLabel: "256K",
    minRamGb: 20,
    recommendedRamGb: 32,
    family: "qwen",
    tag: "Use at your own risk",
    uncensored: true,
    supportsVision: true,
    // The repo renamed its projector from `…-vision-f16.gguf` to the
    // conventional `mmproj-` prefix after this entry first shipped; the
    // old URL answers 404, which stranded a fully downloaded model
    // (installer and daemon key on these two fields, so the filename
    // here must track the repo exactly).
    mmprojUrl: "https://huggingface.co/JonathanColetti/Qwen3.8-27B-Uncensored-GGUF/resolve/main/mmproj-Qwen3.8-27B-Uncensored-F16.gguf",
    mmprojFilename: "mmproj-Qwen3.8-27B-Uncensored-F16.gguf",
    mmprojFileSizeGb: 0.93
  }
];
const DEFAULT_LLAMACPP_MODEL_ID = "qwen-3.5-4b";
let customModels = [];
function setCustomLocalModels(defs) {
  customModels = defs;
}
function listLocalModels() {
  return [...LOCAL_MODELS_CATALOG, ...customModels];
}
const STARTER_LOCAL_MODEL_ID = "qwen-3.5-2b";
function getLocalModelDef(id) {
  const found = listLocalModels().find((m) => m.id === id);
  if (!found) throw new Error(`unknown local model id: ${id}`);
  return found;
}
function isKnownLocalModelId(raw) {
  return listLocalModels().some((m) => m.id === raw);
}
const EMBEDDING_MODELS_CATALOG = [
  {
    id: "nomic-embed-text-v1.5",
    name: "Nomic Embed Text v1.5",
    filename: "nomic-embed-text-v1.5.Q4_K_M.gguf",
    huggingFaceUrl: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf",
    fileSizeGb: 0.084,
    sizeLabel: "84 MB",
    description: "General-purpose 768-dim text embeddings",
    dim: 768,
    pooling: "mean",
    minRamGb: 1,
    recommendedRamGb: 2,
    // Unrelated texts commonly score 0.4–0.5.
    minCosine: 0.55
  },
  {
    id: "bge-small-en-v1.5",
    name: "BGE Small English v1.5",
    filename: "bge-small-en-v1.5-q8_0.gguf",
    huggingFaceUrl: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
    fileSizeGb: 0.034,
    sizeLabel: "33 MB",
    description: "Compact English 384-dim embeddings",
    dim: 384,
    pooling: "cls",
    minRamGb: 1,
    recommendedRamGb: 1,
    // BGE v1.5 compresses similarities into roughly 0.4–1.
    minCosine: 0.6
  },
  {
    id: "bge-base-en-v1.5",
    name: "BGE Base English v1.5",
    filename: "bge-base-en-v1.5-q8_0.gguf",
    huggingFaceUrl: "https://huggingface.co/CompendiumLabs/bge-base-en-v1.5-gguf/resolve/main/bge-base-en-v1.5-q8_0.gguf",
    fileSizeGb: 0.118,
    sizeLabel: "118 MB",
    description: "Higher-quality English 768-dim embeddings (BGE base)",
    dim: 768,
    pooling: "cls",
    minRamGb: 1,
    recommendedRamGb: 2,
    minCosine: 0.6
  },
  {
    id: "bge-m3",
    name: "BGE-M3 Multilingual",
    filename: "bge-m3-Q8_0.gguf",
    huggingFaceUrl: "https://huggingface.co/lm-kit/bge-m3-gguf/resolve/main/bge-m3-Q8_0.gguf",
    fileSizeGb: 0.635,
    sizeLabel: "635 MB",
    description: "Multilingual SOTA (100+ langs incl. Russian), 1024-dim, 8192 ctx",
    dim: 1024,
    pooling: "cls",
    minRamGb: 2,
    recommendedRamGb: 4,
    minCosine: 0.45
  },
  {
    id: "jina-embeddings-v2-base-en",
    name: "Jina Embeddings v2 Base English",
    filename: "jina-embeddings-v2-base-en-Q8_0.gguf",
    huggingFaceUrl: "https://huggingface.co/second-state/jina-embeddings-v2-base-en-GGUF/resolve/main/jina-embeddings-v2-base-en-Q8_0.gguf",
    fileSizeGb: 0.146,
    sizeLabel: "146 MB",
    description: "English 768-dim with 8192-token context (ALiBi long-doc embeddings)",
    dim: 768,
    pooling: "mean",
    minRamGb: 1,
    recommendedRamGb: 2,
    minCosine: 0.55
  },
  {
    // Google's EmbeddingGemma 2 (`gemma-embedding2`, llama.cpp b11454+):
    // Apache-2.0, 100+ languages. Core's module starts it with the
    // GGUF's own pooling, so `pooling` here is informational only.
    id: "embeddinggemma-2",
    name: "EmbeddingGemma 2",
    filename: "embeddinggemma-2-Q8_0.gguf",
    huggingFaceUrl: "https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-Q8_0.gguf",
    fileSizeGb: 0.31,
    sizeLabel: "310 MB",
    description: "Multilingual (100+ langs), 768-dim; needs the Atomic Core engine",
    dim: 768,
    pooling: "mean",
    minRamGb: 1,
    recommendedRamGb: 2,
    requiresCoreEmbeddingModule: true,
    prompts: {
      query: "task: search result | query: ",
      document: "title: none | text: ",
      similarity: "task: sentence similarity | query: "
    }
  }
];
const DEFAULT_EMBEDDING_MODEL_ID = "nomic-embed-text-v1.5";
function getEmbeddingModelDef(id) {
  const found = EMBEDDING_MODELS_CATALOG.find((m) => m.id === id);
  if (!found) throw new Error(`unknown embedding model id: ${id}`);
  return found;
}
function isKnownEmbeddingModelId(raw) {
  return EMBEDDING_MODELS_CATALOG.some((m) => m.id === raw);
}
export {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_LLAMACPP_MODEL_ID,
  EMBEDDING_MODELS_CATALOG,
  LOCAL_MODELS_CATALOG,
  STARTER_LOCAL_MODEL_ID,
  getEmbeddingModelDef,
  getLocalModelDef,
  isKnownEmbeddingModelId,
  isKnownLocalModelId,
  listLocalModels,
  setCustomLocalModels
};
