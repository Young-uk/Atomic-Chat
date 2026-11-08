---
date: 2026-11-07
title: "Select official ISTA IQ2_XS independently"
---

# 2026-11-07 — Select official ISTA IQ2_XS independently

- **Context:** The user rejected the shefowl hybrid's response quality and requested the official IQ2_XS release of the original ISTA model. Model identity must not be disguised as the hybrid or IQ3.
- **Decision:** Add `ista-iq2-xs`, displayed as `Qwen3.8 Flash Next · ISTA · IQ2_XS`, requiring both exact `Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS` shard names under `models/IQ2_XS`. The existing cache isolation creates `kv-cache-ista-iq2-xs`. No implicit legacy second-shard fallback is permitted; a verified identical PLE may be hardlinked at the explicit path.
- **Integrity:** Pin ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF revision `ed59f92082b1e93c0e96d60a8b11aab089b52f09`. Main SHA256: `92cee27ae5bbadcd732416a0f7a7f0acc092399dbbe8f5a5efa707c2ec0a49d7`. PLE SHA256: `316b46f3a2dbd68c900f43136ab9449f9dcc3725dfd8c794847c204bc161e113`.
- **Consequences:** The release includes six IQ1_M gate/up tensors, so a separately verified compatible engine is required before deployment. This app task does not install the engine. Retain 65,536 context and unchanged system limits; finalize the new launcher's memory estimate from measured runtime output. Preserve prior TTS/navigation changes, existing profile caches, settings, and conversations.
- **Owner:** personal fork.
- **Links:** `src-tauri/src/core/dstar.rs`; `2026-11-07-shefowl-hybrid-selection.md`.
