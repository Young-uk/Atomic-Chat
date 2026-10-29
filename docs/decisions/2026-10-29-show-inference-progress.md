---
date: 2026-10-29
title: "Show request-scoped inference progress"
---

# 2026-10-29 — Show request-scoped inference progress

- **Context:** Dstar reports prefill counts in its log, while custom endpoint chat can remain on a generic activity label for minutes. The former prompt-progress store has no live producer on this path.
- **Decision:** The personal Dstar build emits count-only `atomic-progress` SSE comments. The custom-endpoint streaming bridge observes a copy of the response and retains the original bytes for the AI SDK. A thread-scoped, request-owned status row shows waiting, reading, thinking and generating, plus elapsed request time. Only measured input processing receives a percentage; cached tokens are excluded from its denominator.
- **Consequences:** Ordinary OpenAI clients ignore the comments. Older servers still show waiting followed by observed generation phases. Comments carry no prompts, outputs, credentials or file paths. Malformed/unknown records are ignored. Completion, error and cancellation remove the owning request; older requests cannot clear newer activity or update another thread. The display does not estimate loading, reasoning or answer completion percentages and does not change inference or cache decisions.
- **Owner:** @Young-uk.
- **Links:** `web-app/src/lib/inference-progress.ts`, `web-app/src/components/InferenceProgress.tsx`, `web-app/src/lib/model-factory.ts`. Dstar source is maintained separately from this app checkout.

## Follow-up: one live indicator

The active assistant message owns the request status row once it exists; the route only hosts it while waiting for the first assistant part. Reasoning remains a collapsible details section without a competing live clock. Empty generic activity rows are omitted only when the thread has tracked request progress; real tool details and unsupported-provider fallback behavior remain intact. The same request start timestamp survives moving the status row into the assistant message.
