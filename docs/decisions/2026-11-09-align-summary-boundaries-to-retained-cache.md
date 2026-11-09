# Align summary boundaries with retained native cache

## Evidence

A user-driven clone summary reused 58,373 native tokens, but the next request fell back with `no-aligned-retained-run` and reread 32,699 tokens. A read-only diagnostic on the preserved session found the fixed first user turn at token 13,855 and the nominal retained turn at 39,708: deleting 25,853 tokens changes the four-token indexer phase. The unchanged native matcher rejected that slice. Retaining one additional complete turn at UI boundary 123 instead of 125 moved the source to 35,427; the unchanged C++ matcher accepted prefix 13,856 and 22,604 retained tokens. These are CPU token-slice checks, not a new model generation measurement.

## Decision

Keep the native pooled-indexer alignment guards, binary, memory budget and session format unchanged. Before freezing a new cached summary archive, ask the backend to tokenize the nominal retained view and at most fifteen nearest earlier complete user-turn boundaries. Use the same SDK wire serializer and server template encoder as generation. Prefer the nominal boundary if it already matches; otherwise select the nearest earlier aligned turn whose full retained input plus 4,096 summary/output reserve fits within 80% of the main context. Never move later than the nominal boundary or into the existing archive.

This can retain additional older dialogue; the recent-history target remains a minimum. It does not enlarge the summary output cap or add GPU state. If no compatible, budgeted candidate exists, preserve the original boundary and existing safe fallback rather than claim arbitrary cache bytes are valid.

Keep committed token IDs alongside the existing owner receipt in host memory. After compatible disk restore, read only the bounded v1/v2 token table and verify its count and native commit hash. Unknown formats remain usable for normal inference without an alignment claim. No transcript text is logged. CPU planning never generates tokens or changes native cache state; native FORK and foreground compaction still perform their existing validation.

## Validation

Regression tests cover all three nonzero indexer phases, closest earlier-turn selection, budget/owner guards, disk token-table validation, SDK serialization, frozen archive boundaries and retained recent dialogue. Full app verification and local installation are recorded in the task outcome. Actual inference remains user-driven.
