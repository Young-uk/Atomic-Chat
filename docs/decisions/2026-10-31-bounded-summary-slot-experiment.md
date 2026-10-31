# Bounded background summary experiment

Status: isolated experiment; disabled in normal Personal builds. No deployment
or publication is authorized by passing unit tests alone.

## Decision

Keep the foreground session at its configured 64K context and allocate only
8K for the dedicated summary session. Summary requests use no reasoning and
no speculative MTP decode. Never batch summary decode with foreground decode;
foreground prefill and pending decode take priority at GPU scheduling boundaries.
Running GPU commands are not preempted. Continuous foreground work may delay
summarization; the UI must not claim it is complete while it waits.

Feed old evidence in consecutive fragments. Bound the serialized instruction
and input content to 6000 UTF-8 bytes, leaving room for the chat template and
768 output tokens. Carry the last successful summary into the next fragment.
Reject empty, truncated, failed, oversized or cancelled results. Return only
the final successful merge to the existing durable archive transaction.
A fragment may split JSON evidence, but it is explicitly labelled as data with
its original offset; original archived UI messages remain intact.

The server enforces the summary prompt's exact 8192-token limit independently
of the foreground capacity. This experiment does not change the 70% trigger,
20% recent-context retention, user-turn application boundary or archive search.

## Validation gate

Use isolated synthetic history and caches. Retain at least 58K foreground
prompt tokens, start summary work, then append a new foreground request with
synthetic tool-result evidence. Record cache counts, elapsed time, errors and
process residency. Process RSS is not an exact Metal allocation peak; do not
report it as one. Abort before excessive residency, preserve the installed
single-slot binary and restore the original server afterward.

The earlier real Metal OOM remains the regression baseline. A short synthetic
pass is insufficient. Keep the feature flag and automatic server startup off
until long-context, actual chunked-summary and native-app integration have
passed with acceptable memory and latency.

## User-authorized local test deployment

The user requested installation for hands-on testing after reviewing the known
latency limitation. Build with `VITE_DSTAR_BACKGROUND_COMPACTION=true` and
`ATOMIC_DSTAR_SUMMARY_TEST=true`; the latter adds `--summary-slot` only to this
opt-in native build. Preserve the installed app and server before replacement.
Keep conversation data and settings intact. Do not publish, commit or push.
The 25-second overlap latency and unmeasured Metal peak remain limitations.
