# Show request-scoped input progress for managed local engines

Dstar emits atomic-progress SSE comments counting the unread suffix. Strata emits opt-in prompt_progress JSON counting the full prompt including the reused prefix. Enable return_progress only for the identity-checked managed Strata route, and normalize its counters by subtracting cache. Preserve the stream bytes and request identity boundaries. Stale observers cannot update newer requests or context usage.

The input-area row remains mounted during assistant output and tool continuations. It shows actual new-input token counts, a percentage rounded down to one decimal, elapsed time and a separate reused-prefix count. Missing or invalid counts retain the phase and timer without inventing a percentage. Existing reasoning, generation and bounded completion-review labels remain available. No runtime, native binary, cache identity or model parameters are changed.

Verification covers fragmented events, invalid counters, request isolation, full context usage and real-browser narrow layouts in both themes and font sizes. Model inference tests remain user-run.
