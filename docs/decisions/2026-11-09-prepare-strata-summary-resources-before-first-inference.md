---
date: 2026-11-09
title: "Prepare Strata summary resources before first inference"
---

# 2026-11-09 — Prepare Strata summary resources before first inference

- **Context:** A restored long conversation can require recovery compaction before its first foreground inference. The Metal state-bank gate previously rejected cold expert arenas and prompt scratch until a foreground request warmed them, creating a circular dependency and HTTP 409.
- **Decision:** Pin the opt-in personal runtime to the v17 native build. Before allocating or selecting a summary bank, initialize the same shared expert arena and prompt scratch used by foreground work, without evaluating tokens. Recheck memory pressure, swap stability and free RAM before and after preparation. Keep all existing bank allocation, quiescence, publication and rollback checks. Native state-bank protocol 6 advertises cold preparation; Python still accepts protocol 4 and correctly reports its foreground warm-up requirement.
- **Consequences:** Cold recovery no longer needs a dummy question. First preparation can take time for weight reads and shader compilation. Insufficient memory still refuses admission without replacing main state. Inference math, normal background quanta, urgent recovery quanta, retained-history reuse, runtime integrity checks and reboot-stable artifact pins remain unchanged. Dstar already creates its dedicated summary session at startup and needs no corresponding code change. Model-free regression checks and a resource-only native begin/end round trip validate control flow; generated summary quality remains for user testing.
- **Owner:** personal build maintainer.
- **Links:** `src-tauri/src/core/managed_engines.rs`; Strata `metal/src/engine/window.cpp`, `include/strata/core/summary_state_bank.hpp`, `serve/server.py`.
