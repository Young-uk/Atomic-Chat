---
date: 2026-11-10
title: "Reuse earlier Dstar summary checkpoints"
---

# Reuse earlier Dstar summary checkpoints

- **Problem:** Dstar could clone only the current conversation frontier. When the task and output did not fit, recovery reread the archived text despite earlier complete disk checkpoints.
- **Decision:** share the app's CPU-only source-prefix envelope with both personal backends. Dstar renders it using its own historical tool/effort serializer without a generation prompt. Image markers become placeholders, expanded only against exact bound native IDs with the completed UI history receipt. No image encoder runs for this proof.
- **Recovery:** if the current clone leaves less than 4096 output tokens, prefer an earlier complete disk checkpoint covering the entire archived source. Validate file type, disk key, model/quant/context, native payload and exact prefix IDs before adopting it in the disposable summary slot. The bound foreground remains untouched. A margin selects a checkpoint; generation still uses all remaining physical room with max_tokens:0. Missing/stale/insufficient checkpoints retain existing preserved-original fallback.
- **Persistence:** use Dstar's existing disk payloads, including recurrent/GDN, PLE, indexer and image positions. No payload format or KV budget changes. The opt-in personal summary launcher requests existing periodic checkpoints every 4096 tokens; ordinary launch defaults remain unchanged. The same disk index works after restart.
- **Validation:** server/scheduler/clone/history/thread-cache fake tests and CPU build are required, plus actual IQ3_XXS inference and restart checks in an isolated cache, and the app verification gate. Results and measured limits are recorded with the personal build evidence.
