---
date: 2026-11-10
title: "Recover summaries from conversation checkpoints"
---

# Recover summaries from conversation checkpoints

- **Problem:** a cached conversation can leave too little physical room for summary instructions and output. Independent extraction then rereads the archived conversation.
- **Decision:** opt into a native query and checkpoint fork. The app sends an exact foreground source envelope as CPU-only metadata. The server tokenizes it without a generation prompt and proves that it is a prefix of the bound main cache. Only a native checkpoint at or after the archived source end is eligible. Its token hash and the complete main hash/count are revalidated by the engine before publication. The separate bank copies KV and restores the checkpoint's recurrent, convolution, PLE and indexer state. Later main image positions are replaced only in the branch's private suffix position table.
- **Output:** prefer a checkpoint leaving at least 4096 output tokens when the current clone has less room. This is a branch-selection margin, not an output cap: `max_tokens:0` uses all remaining native physical capacity. The prose target and temperature remain unchanged.
- **Persistence:** personal configuration enables existing periodic 4096-token checkpoints and spread retention. Disk SAVE can retain up to three compatible prefix anchors (deepest, oldest, middle), accounting for every copied state before allocation. Other configurations retain the existing single-checkpoint default and file format.
- **Safety and limits:** a checkpoint before the source end is never used: no archived evidence is omitted and image rows are never replayed without embeddings. Placeholder expansion requires the completed-history receipt. Stale, unavailable or too-late checkpoints retain the existing preserved-original recovery fallback. Existing single-checkpoint disk files cannot invent missing older states. Full main ownership is retained for disk rollback, including clean bank-allocation refusal.
- **Validation:** CPU tests cover source coverage, image attestation, stale bindings, protocol identities, multi-anchor memory admission and unchanged default SAVE selection. Metal validation and app verification results are recorded with the local build evidence. This personal Metal feature makes no CUDA/HIP/SYCL performance claim.
