# Budget summary refreshes against rendered model input

A live conversation reused 52,382 tokens, then a new summary advanced the archive
by two messages and reduced reuse to 10,516 tokens. Prefix KV reuse cannot reuse
an unchanged suffix after earlier messages are removed. The old boundary counted
raw parts without historical tool catalogs, while its trigger could let an
inflated heuristic override a measured request usage.

For completed requests, use measured input plus output usage when available.
Keep the 70% trigger. For ordinary background refreshes, choose the earliest
complete-turn boundary whose rendered retained input plus a 2,048-token memory
reserve fits 50% of context. Include historical tool/effort/completion wrappers
and the original catalog anchor in that estimate. Preserve at least the existing
recent-history target; if fixed overhead or a protected large turn prevents the
target, do not churn small refreshes. Explicit overflow recovery and legacy
request-ledger migration retain their existing paths.

This is a conservative rendered estimate, not an exact tokenizer measurement.
The final summary can exceed the reserve and newly appended messages can add
input; no fixed post-summary occupancy or full suffix KV reuse is promised.
Tests cover measured usage, complete-turn selection, protected history, and
repeated impossible targets. Real installed behavior requires separate QA.
