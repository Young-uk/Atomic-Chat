# Append-only Dstar tool catalogs and duplicate search output

Status: deployed locally for testing; not pushed.

## Decision

Under the existing opt-in Qwen3.8 Dstar gate, record canonical OpenAI tool
catalogs on user-message metadata after discovery settles and initial message
writes complete. Render changed catalogs as trusted `atomic-tools:v1:` system
events at their original positions. Dstar suppresses the changing request-wide
catalog prefix only when a valid event exists. Unmarked clients retain existing
behavior. Request tools still carry the current allowlist; chat execution
rechecks current tool availability after approval, including connector toggles.

Tool results append normally. At ingest only, remove a bundled search summary
when it exactly duplicates the numbered title/URL/snippet rendering of structured
results. Preserve every structured field and all unfamiliar or nonidentical
summaries. Do not truncate, summarize, or rewrite historical results.

## Limits and validation

The first migration changes legacy tool placement and may require full prefill.
Subsequent catalog changes should preserve the prior prompt prefix. Results
still require reading new tokens. This does not promise model adherence or
constant-time tool results. Validate enable/change/disable, persisted replay,
wire message ordering, unavailable-tool rejection and exact-duplicate handling.
Live cache and model tool-choice behavior require separate verification.

## Persistence identity

The SDK's `Chat` identifier is independent of Atomic's persisted thread ID.
Snapshot reads/writes must use the transport's bound thread ID. A production
transport harness exercises different IDs and verifies persisted metadata and
the actual model-bound prompt. SDK message objects are reconciled with stored
snapshots on every send so previously recorded events survive in-memory turns.

## Verified local outcome

Final web/core: 7,725 passed, 19 skipped; extensions: 525 passed; critical
coverage floors passed. Native Rust suites: 1,550 passed, 13 ignored after
rerunning local-port tests with local execution permission. Dstar frontend
regressions and native Personal app build passed.

In the installed app, enabling search reused 4,017 tokens, tool-result
continuation reused 5,105 tokens and read 216 new tokens, and disabling search
reused 5,349 tokens. Search result cards remained visible, structured results
were preserved and the exact duplicate summary was absent from stored output.
After restart, catalog metadata replay was preserved. The first request failed
to restore a disk KV prefix and read 6,244 tokens; the following request reused
6,273 tokens and read 53 new tokens. Disk-cache restoration remains a separate
unresolved limitation; no compatibility checks were bypassed.
