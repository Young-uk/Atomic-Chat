---
date: 2026-11-08
title: "Negotiate experimental weighted summary priority"
---

# 2026-11-08 — Negotiate experimental weighted summary priority

- **Context:** Protocol 4 advertises a separate mutable-state bank but does not promise summary progress during foreground decoding. Foreground conversation should have priority without cancelling or restarting summary fragments or waiting for the whole response.
- **Decision:** Accept protocol 5 only with `shared-weights-priority-v1`, the existing explicit experimental state-bank invariants, and a valid `weighted-quanta-v1` scheduler. Foreground weight is an integer from 1 to 64 (runtime default 8); summary weight is 1. Compute remains serialized. Require nonnegative safe-integer counters, a known active lane, and `recovery_required: false`. Preserve protocol 3 and 4 negotiation unchanged.
- **Consequences:** Protocol 5 explicitly requires `continuation_text_only: false`, `foreground_preparation: legacy-first-token-v1`, and `foreground_prefill_exclusive: true`. Initial prompt/image preparation through the first foreground token exclusively owns compute for cache/image correctness; subsequent decoding uses weighted quanta. This is not simultaneous GPU execution or a TTFT guarantee. Scheduler observations do not mean cancellation or whole-response pause: the existing in-flight summary indicator remains active and completed sections survive. No runtime installation, qualification, model validation or safety/performance claim follows from capability discovery. Native admission and recovery remain authoritative; a fresh probe fails closed if the descriptor is unsupported or recovery is required.
- **Owner:** team.
- **Links:** `web-app/src/services/local-model-capabilities.ts`, `web-app/src/lib/dstar-summary-idle.ts`, `web-app/src/components/ContextSummaryProgress.test.tsx`, [Separate experimental summary state](2026-11-08-separate-strata-summary-state.md).
