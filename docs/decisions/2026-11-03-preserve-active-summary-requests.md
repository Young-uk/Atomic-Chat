---
date: 2026-11-03
title: "Preserve active summaries during foreground chat"
---

# 2026-11-03 — Preserve active summaries during foreground chat

- **Context:** The app aborted the current summary HTTP fragment on each foreground turn, discarding partial inference and retrying the same fragment after chat. Dstar already has separate resident slots and prioritizes foreground prefill/decode between bounded GPU units.
- **Decision:** Submit each summary fragment once, independent of the frontend foreground lease. Keep the owner cancellation signal and existing timeout/error behavior. Leave server scheduling unchanged and apply completed summaries only on a later request.
- **Consequences:** Chat no longer restarts summary fragments. GPU execution remains shared and chat-prioritized; this does not guarantee simultaneous GPU execution or a speedup under sustained foreground load. History edits and explicit owner cancellation still abort obsolete work. The gated live test checks both completed requests without a frontend paused phase.
- **Owner:** @Young-uk.
- **Links:** `web-app/src/lib/dstar-summary-idle.ts`.
