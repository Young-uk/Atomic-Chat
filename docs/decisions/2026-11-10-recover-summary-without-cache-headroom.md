---
date: 2026-11-10
title: "Recover summaries without cache headroom"
---

# 2026-11-10 — Recover summaries without cache headroom

- **Context:** a bound conversation can leave too little room for appended summary instructions and output. Saving the full main state to disk does not create token space. A live recovery was refused with `serial recovery token headroom exhausted` after the state-bank memory gate had refused cloning.
- **Decision:** reject provable clone overflow before allocating or saving. Preserve a specific headroom error through HTTP/SSE and the coordinator. Only urgent recovery may switch once to the existing tokenizer-bounded complete-turn extractor. Stale cache, cancellation, arbitrary errors and uncertain state never authorize fallback. Strata validates the same native owner, exclusively saves the original main, runs independent text through the existing APREP/GEN preparation path, and restores the exact saved token/byte identity before releasing admission. Dstar uses its existing isolated summary slot, without a Strata disk command.
- **Consequences:** emergency work rereads bounded text and can pause foreground work while the main is temporarily used. It has no new 128-input or wall-clock restriction. Original messages, the newest user turn, verified ledgers and durable extraction checkpoints remain authoritative. Normal summaries keep the cached path. Failed restore retains the private artifact and blocks inference. A single oversized complete turn or unavailable safe SAVE/RESTORE can still block recovery; no user text is silently truncated. Model-free protocol and coordinator tests cover rollback and boundaries; actual model inference is reserved for the user.
- **Owner:** personal fork.
- **Links:** `web-app/src/lib/strata-cached-summary.ts`, `web-app/src/lib/dstar-context-compaction.ts`, `serve/atomic_summary.py`, `serve/priority_client.py`.

A restored session without a complete semantic clone binding retains only its native-restored token count and recorded owner as a cold-preservation receipt. It cannot authorize cache append, fabricate a tail or token IDs, or summarize another owner. It may prove insufficient capacity and authorize independent cold text while the same native count is saved/restored. The receipt is invalidated before any new foreground preparation.
