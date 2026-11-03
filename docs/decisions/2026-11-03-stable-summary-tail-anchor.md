---
date: 2026-11-03
title: "Preserve a stable retained-tail summary anchor"
---

# 2026-11-03 — Preserve a stable retained-tail summary anchor

- **Context:** A generated assistant response ID can differ from the persisted response ID. The missing-anchor recovery moved a completed summary to the archived-prefix boundary, invalidating most of the live prompt cache.
- **Decision:** Capture a stable user-message fallback with each summary snapshot. If the preferred assistant anchor disappears, use that fallback once and persist it. Legacy missing anchors acquire a fixed retained-tail position before the newest user question. Never restore archived raw messages.
- **Consequences:** Subsequent requests preserve summary placement across restarts and appends. Compaction still removes older raw turns, so that intentional input change can require recomputation; this does not promise reuse of non-prefix KV states. Existing valid placements are unchanged.
- **Owner:** @Young-uk.
- **Links:** `web-app/src/lib/dstar-context-compaction.ts`.
