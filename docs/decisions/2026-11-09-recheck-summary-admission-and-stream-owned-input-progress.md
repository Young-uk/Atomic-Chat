---
date: 2026-11-09
title: "Recheck summary admission and stream owned input progress"
---

# 2026-11-09 — Recheck summary admission and stream owned input progress

- **Context:** Cold shared-resource preparation can take about 25 seconds and then cleanly refuse the summary bank because memory conditions changed. The native refusal was hidden by a generic error. Non-streaming summary responses also hid input progress until completion.
- **Decision:** Retry native BEGIN exactly once only for its explicit clean post-preparation refusal. Release and reacquire the existing compute permit and run the complete native memory, pressure and stable-swap gate again. Cancellation, ordinary memory refusals and uncertain transitions never trigger this retry. Log every refusal. Surface only fixed reviewed admission messages. Negotiate streaming summary responses on the new Strata runtime; Dstar already supports per-request input comments. Collect the same final summary text while forwarding real input counters into the existing summary row. Bind Strata counters to the cancellation/request owner rather than the shared engine object. Reject truncated streams, preserve originals and retain all existing summary validation and checkpoint rules.
- **Consequences:** Resource initialization does not automatically fail a request when a fresh safety check succeeds. Real sustained pressure still defers work. Shared-resource initialization has no measured percentage, so the UI names that preparation phase. Input percentages describe the current bounded summary request, not the whole archive or overall completion. Foreground context usage and progress remain separate. No model inference math, input evidence, batch thresholds or scheduling quanta change.
- **Owner:** personal build maintainer.
- **Links:** `web-app/src/lib/summary-stream.ts`, `web-app/src/lib/dstar-summary-batches.ts`, `web-app/src/components/ContextSummaryProgress.tsx`; Strata `serve/atomic_summary.py`, `serve/priority_client.py`, `serve/server.py`.
