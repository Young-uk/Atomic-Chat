---
date: 2026-11-14
title: "Adopt ready summaries under measured context pressure"
---

# Adopt ready summaries under measured context pressure

- The previous cache-preserving handoff could remain deferred until physical overflow. Its preliminary heuristic reported 83,711 tokens while the real request contained 125,988 in a 131,072-token context.
- Keep the existing 85% prompt-pressure policy. Before a new user turn, measure the current rendered foreground envelope with the running server tokenizer. At or above that threshold, commit a matching prepared summary even if native retained-cache alignment is unavailable. This may require one compacted prefill; cache reuse never overrides context headroom.
- Under pressure remove raw overlap retained only for cache alignment, preserving the immutable archive source and only historical summary anchors still in the actual retained tail. Persist the selected boundary before committing it. Edited sources invalidate pending summaries. Tool continuations do not adopt a newly prepared summary mid-turn.
- Use tokenizer measurements, including fixed instructions, tools, template options, images and output reserve, for restored-summary budgeting and the foreground fit gate. Memoize identical envelopes within one send. The SDK's final serialized-body check remains authoritative for provider overrides and every tool step.
- Tests reproduce the 83,711/125,988 mismatch, failed alignment followed by pressure adoption, removal of overlap, source-edit rejection, pre-inference adoption in the transport, and existing foreground-overflow recovery.
