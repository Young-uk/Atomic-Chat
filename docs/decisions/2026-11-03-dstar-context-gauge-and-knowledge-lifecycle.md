# Dstar context gauge and knowledge lifecycle reads

Dstar's custom endpoint has no editable local `ctx_len`, so the existing gauge
was hidden. Show a read-only gauge using the running endpoint's `/models`
context length and the latest completed response usage for the selected model.
Label the value as last reported request usage, not a live tokenization of the
full archived transcript. Pending input and compaction can change the next
request. Unknown values display a dash. Switching models must not reuse the
previous model's usage or limit; failed runtime probes clear the stale limit.
Existing local-provider token calculation and context sliders remain unchanged.

Lessons and procedures retain their records after deprecation, but the tool's
shared history action was unsupported for them. Expose lifecycle history with
the retained entry and its known creation/deprecation timestamps. This is not
an edit-version log, and does not invent past contents or migrate user data.
The tool description now explicitly distinguishes this from profile versions.

History reads explicitly distinguish a retained record (`found: true`) from a
valid but unknown ID (`found: false`, `reason: "not_found"`). Both preserve the
existing `entry` and `events` fields. Invalid IDs and storage errors still fail;
they must never be disguised as an absent record. This response-only addition
keeps the tool catalog unchanged to avoid unnecessary prompt-cache invalidation.
