---
date: 2026-11-08
title: "Keep completion review an experimental opt-in"
---

# 2026-11-08 — Keep completion review an experimental opt-in

- **Context:** Completion review is not qualified as a reliable classifier. Conditional offers can be mistaken for unfinished work. The user explicitly requested an enable/disable option rather than automatic enablement.
- **Decision:** Add a global personal-build General setting, `completionReviewEnabled`, defaulting to false. Persist it additively without a schema-version bump or preference-reset migration. Only literal boolean true opts in after rehydration. New requests snapshot the preference and still require runtime capability negotiation; unsupported runtimes skip review. Supported Dstar and Strata review may initiate at most one follow-up.
- **Consequences:** The UI discloses extra local inference and latency, classification errors, unchanged tool permissions, and that this is not fact checking. Opt-in does not qualify classifier accuracy or authorize tools. Enabling applies to new requests. Disabling prevents a pending review or its follow-up from starting, without interrupting the foreground answer. A newer request, model switch or runtime replacement also prevents the stale follow-up.
- **Runtime contract:** Dstar retains its explicit advertisement. Strata uses a separate `atomic_completion_review_experimental` advertisement plus the complete healthy state-bank contract; its semantic qualification flag stays false. The isolated v12 runtime and app backend pin are deployed together, leaving v7 intact for rollback.
- **Supersedes:** The forced app-wide gate in `2026-11-08-gate-unqualified-completion-review.md` is replaced only for explicit opt-in; the observed false-positive risk is not resolved.
- **Owner:** team.
- **Links:** `web-app/src/hooks/useGeneralSetting.ts`, `web-app/src/containers/CompletionReviewSetting.tsx`, `web-app/src/lib/custom-chat-transport.ts`.
