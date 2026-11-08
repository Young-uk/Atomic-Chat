---
date: 2026-11-07
title: "Select the installed shefowl hybrid explicitly"
---

# 2026-11-07 — Select the installed shefowl hybrid explicitly

- **Context:** The personal Dstar controller originally recognized only the ISTA Q2_0, IQ3_XXS, and IQ3_S variants. The selected shefowl512E release mixes IQ3_XXS and Q2_0 and must not be described as IQ2_XS or as the original IQ3 model.
- **Decision:** Add `shefowl-hybrid` with the display name `Qwen3.8 Flash Next · shefowl512E · IQ3_XXS/Q2_0`. Require both full `Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-Q2_0` shard filenames under `models/SHEFOWL-HYBRID`; do not silently search legacy quant directories. A separately verified identical shard may be hardlinked into that directory by the installation workflow.
- **Consequences:** The existing validated selection and persistence flow launches the installed Dstar script using the new ID, with the already isolated `kv-cache-shefowl-hybrid` directory. Original IQ3 cache, defaults, MTP, vision resources, and engine binaries remain unchanged. The matching external launcher must recognize this ID before installing this app. Model download, integrity verification, and migration remain explicit installation steps, not UI side effects.
- **Owner:** personal fork.
- **Links:** `src-tauri/src/core/dstar.rs`; `2026-10-29-manage-dstar-in-the-personal-app.md`.

The external launcher uses a hybrid-only 40.1 GiB base, two KV allocations at 6.63e-5 GiB per context token, and 2 GiB headroom. At the tested 65,536 context this admits approximately 46.45 GiB against measured approximately 44.2 GiB including shared summary context and vision. The hybrid must fit the computed default wired budget; old profiles and system limits are unchanged. Higher contexts were not runtime-validated.
