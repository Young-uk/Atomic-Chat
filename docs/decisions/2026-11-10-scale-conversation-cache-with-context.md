---
date: 2026-11-10
title: "Scale the personal conversation cache with context"
---

# Scale the personal conversation cache with context

- **Problem:** the personal Strata launch fixed conversation parking at 1024 MiB. A measured 1634 MiB snapshot of a 62K conversation was refused when a tiny side request displaced it, forcing a subsequent long request to reread its prompt.
- **Decision:** compute the lazy byte budget from the configured foreground context: 14,208 bytes per token for the pinned int8 layout plus 1 GiB for recurrent checkpoints, indexer state and descriptors, rounded upward in 256 MiB steps. Examples are 1280 MiB at 16K, 2048 MiB at 64K, 2816 MiB at 128K and 4608 MiB at 256K. There is no additional context ceiling. The engine still measures the actual snapshot size and applies its existing physical-RAM admission and LRU eviction rules; this cap does not reserve or allocate that amount at startup.
- **Side requests:** opt into the existing 1024-token minimum for parking. Tiny probes still execute normally, but their expensive fixed-state snapshots cannot occupy parking slots or evict useful conversation caches. This is not an inference chunk or token limit.
- **Identity:** cache budget and parking eligibility do not change the native session layout. Verify the exact previously pinned 64K policy first, validate the projected capacity and minimum, and derive a same-context reviewed disk-session bridge from the previous policy. Preserve the native/backend checks, historical 64K upgrade identities and native payload validation. Do not bridge different contexts or changed model/KV settings.
- **Validation:** numeric capacity tests cover 16K through the accepted integer boundary. Pin-projection tests reject budget, minimum, backend and unreviewed argument drift and require exact source/destination identities. Read-only tests use actual pinned artifacts; model-backed validation must exercise a long snapshot larger than the old budget, short side requests and return to the original token prefix without rewriting the production cache.
