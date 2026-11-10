---
date: 2026-11-10
title: "Anchor scheduled delivery after whole model turns"
---

# Anchor scheduled delivery after whole model turns

- **Context:** the disk session restored 50,949 tokens, but the first request reused zero and reread 49,454 tokens in about 384 seconds. A read-only token replay found a scheduled assistant notice interleaved between the steps of a live tool-bearing assistant response. Durable replay combines those steps and places the notice outside the response. The saved prefix therefore differs even when restoration succeeds.
- **Decision:** persist a fixed originating user-turn anchor and stable delivery order on new scheduled chat messages. Continue saving, displaying and notifying immediately. The model-only projection excludes anchored notices during that user's unfinished turn, then places them after the whole turn and before the next user message. Every transport request uses this projection before cache ownership, summary and conversion logic. Delivery retries reuse the saved message and anchor. While streaming, insert the visible notice before the active assistant message so the SDK keeps updating its last response instead of pushing a duplicate response ID. Legacy notices and missing anchors retain their existing behavior.
- **Consequences:** notification timing is unchanged; an in-progress model response sees a newly arriving notice at the next user turn. Restart replay preserves the same whole-turn ordering. Existing divergent bytes are not rewritten. Both managed engines share this application path. Verify live continuation and restart request equality, immediate delivery, retries and stable ordering with fake models; no real-model inference tests.
- **Owner:** personal fork.
