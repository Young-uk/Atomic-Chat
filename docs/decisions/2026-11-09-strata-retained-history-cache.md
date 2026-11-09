# Strata retained history cache and urgent summary priority

Personal Strata can retain an unchanged fixed prefix and a long matching dialogue run after an explicitly labeled historical handoff changes. This is approximate: recurrent and PLE state preserve removed history, as in the Personal Dstar history cache. It is not equivalent to replaying the compacted conversation.

The first implementation is limited to single-session text-only Metal INT8 without a draft model. Prefix, source and retained length must align to four-token indexer blocks. The matcher requires at least 512 retained tokens and always evaluates fresh input before sampling. Other layouts, images, incompatible boundaries and exhausted absolute-position headroom use normal prefix reuse/recomputation. Diagnostics report the fallback; reused-token counts remain actual native cursor counts.

K/V codes, scales and pooled indexer rows move together after GPU quiescence. Old checkpoint chains and parked provenance are invalidated. Absolute RoPE positions follow retained cells; bounded position tables have four-context headroom. Approximate sessions are not parked in RAM. Disk snapshots explicitly use version 2 with a bounded authenticated absolute-position vector; ordinary version 1 snapshots remain byte-identical. The app pins the paired native binary and backend. Prior binaries and cache files are retained.

Urgent overflow recovery uses an explicit summary-only request flag. Normal background fairness remains 8:1 with 128 idle input tokens or 1 when foreground work waits. Recovery uses ordinary 2048-token physical chunks and priority while preserving exclusive GPU ownership, per-token decode and cancellation boundaries. Completed extraction batches survive promotion from background to urgent work.

The composer exclusively renders request progress. Reasoning disclosures stay inside messages without another request clock or input bar.

Validation covers matcher guards, position validation, unchanged v1 golden bytes, v2 round trips, native continuation bounds, CPU snapshot transfers, backend scheduling and the app suite. Model inference and approximate output quality are left for the user's manual validation.
