# Preserve completed text handoffs across engine updates

Text handoffs previously used the same archive scope as engine-specific derived
state: provider, endpoint, model and engine fingerprint. After the v24 update,
the old completed handoffs were excluded, the first request expanded to 83,268
tokens, and recovery started independent 16K summaries before any main cache was
available to clone. Native logs confirmed main=0 and cloned=0.

Completed text summaries can now be read across engine fingerprints when the
provider, endpoint and model identities match exactly. Only structured legacy
identities with three or four nonempty string fields are compatible. Unknown,
unscoped or malformed identities remain isolated. Thread identity is checked on
read, and ContextCompaction verifies the entire archived source prefix before
using any candidate. Edited histories cannot adopt an older handoff. The existing
foreground token preflight still verifies that the projected prompt fits.

Incomplete extraction checkpoints stay bound to the exact engine scope. Native
RAM state, disk-session manifests, process ownership, model fingerprints and
runtime qualification pins are unchanged. No old disk session is rebound to a
new engine. Archives and original thread messages are preserved.

This fixes startup handoff adoption for both managed engines through their shared
archive store. It does not synthesize a native cache when none exists: the first
foreground request after a cold start still reads the compacted conversation.
Subsequent ordinary text summarization can clone the warmed Strata cache. Legacy
recovery remains necessary when no matching completed handoff or main cache is
available.

Regression checks cover completed-handoff portability, strict pending checkpoints,
provider/endpoint/model/thread isolation, read-only lookup and edited-source
rejection. Model inference remains the user's manual validation.
