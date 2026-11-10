---
date: 2026-11-10
title: "Let summaries finish within real context capacity"
---

# 2026-11-10 — Let summaries finish within real context capacity

- **Context:** a cached summary finished with length at exactly 2048 output tokens after 223 seconds. Its prompt allowed 2000 prose tokens inside a 2048-token JSON cap. A normal 346-token tool-bearing answer had already completed. This was incomplete summary output, not evidence of failed cache restoration.
- **Decision:** retain an approximate prose target, remove the fixed generation cap, and send max_tokens zero for summary requests. Both supported servers interpret zero as the actual remaining summary context. Strata rechecks the bound cached prefix at dispatch, including its tail and context slack. Dstar uses its summary slot's remaining capacity and leaves ordinary request budget semantics unchanged. Explicit positive caller budgets remain supported. Existing open work is retained by the durable ledger and is not re-emitted into JSON.
- **Consequences:** complete output can exceed 2048 tokens and is validated without slicing. EOS and cancellation still end generation. A provider length finish is never committed as valid JSON; the coordinator can switch once to the existing complete-turn fallback, preserving originals and newer dialogue. No stronger shortening retry or new generation deadline is introduced. Legacy input planning retains its input safety reservation; it is not an output cutoff. Model-free HTTP tests exceed 2600 generated tokens, including a bound clone, and check prefix-adjusted capacity.
- **Owner:** personal fork.
