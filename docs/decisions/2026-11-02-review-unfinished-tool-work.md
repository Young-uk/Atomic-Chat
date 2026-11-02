# Review unfinished tool work without replacing the foreground cache

## Problem

A Personal Dstar answer announced a weather lookup and finished with no tool
call. A natural progress policy alone does not make that announcement an action.
The user approved one model-based completion review and a bounded continuation.

## Decision

For tool-enabled Personal Dstar turns, after a successful text-only stop, review
only the latest public request, public answer and available tool names on the
existing background slot. No private reasoning or older conversation is sent.
The review has no executable tools and returns complete or needs_tool JSON.
Only needs_tool starts one normal tool-capable continuation. It does not choose
arguments, grant permissions, or execute anything itself. Current-turn denials,
errors, cancellation, output truncation and absent server capability disable it.
Ordinary answers incur one short review. Invalid/unavailable reviews preserve the
answer without silently executing work. Evidence over the conservative 6,000-byte
input budget is not truncated and is reported internally as unavailable.

Keep the interim text visible and save the continuation boundary in assistant
metadata. Replay this boundary at the same position after restart. Dstar treats
only the explicitly labeled internal notice as an in-place system entry; other
system messages retain their established behavior. The server advertises this
capability so older servers never receive an unsupported notice. Delay summary
and automatic memory formation until the combined response has actually ended.

## Related restart issue

Persisted plain assistant text was trimmed when reconstructed as UI messages.
Dstar intentionally preserves trailing whitespace in plain answers, so this can
change a compatible prompt only after restart. Restore public text verbatim;
legacy text containing embedded think tags retains its existing parsing rules.
This is a transcript fidelity fix, not permission to reuse incompatible caches.
Full matching snapshots can still be absent or evicted under the disk budget.

SDK step-start boundaries were also dropped by ThreadContent serialization.
Record semantic content positions as atomic_model_steps_v1 on successful turns,
then restore them before converting history to model messages. Legacy rows may
recover the unambiguous tool-to-text/reasoning boundary; adjacent parallel calls
remain grouped. This preserves the tool/result/answer order without inventing
missing raw tool syntax or relaxing byte-prefix validation.

## Validation

Focused tests cover structured decisions, invalid/truncated review output, input
bounds, current-turn denial, normal answers, one continuation, retained interim
text, single finish, delayed summary, and durable boundary replay. Installed-app
and real-model validation remain required before claiming end-to-end success.

## Installed validation (2026-11-02)

The installed Personal app retained the interim update, requested the ordinary
one-time approval for a read-only native catalog call, and displayed REVIEW_TOOL_OK.
The first server build exposed a missing assistant generation prefix after a
terminal internal review notice. The corrected server preserves that prefix;
its server tests pass, and the installed tool-result request reused all 19,190
existing tokens, evaluating only the 4,841-token catalog result.

The initial restart test recovered only the 6,723-token fixed prefix from an
older snapshot. Full-conversation restart restoration is still under validation
and is not established by the successful live tool-result reuse above.

## Tool result persistence ordering

A real tool-tail restart reproduced a distinct byte mismatch: runtime MCP content
items serialized as `{"type":"text","text":...}` while Rust persisted JSON
restored them as `{"text":...,"type":"text"}`. Normal-answer restart restored
24,348 tokens, but immediate tool-tail restart rebuilt the suffix. Canonicalize
plain tool output object keys before Dstar model conversion, both live and after
restore. Preserve array order and all text bytes; do not parse or rewrite JSON
embedded in text. Other providers remain unchanged. Regression coverage compares
wire serialization before and after a simulated Rust JSON storage round trip.
Existing checkpoints with the old key order may require one rebuild.

## Final installed tool-tail restart validation

With the canonical tool-output ordering build installed (SHA-256
429194d4b4adbeb084d67abf0a0187934f7cd2e021fe0e43be69fc569bd5c989),
a separate synthetic chat completed a catalog call after a one-time approval.
The app and owned Dstar server quit normally, saved a 35,290-token checkpoint,
and restarted with the same SSD IQ3_XXS model and 65,536-token context. The first
request restored all 35,290 cached tokens from disk, evaluated only 247 new
tokens, and visibly completed CANONICAL_DISK_OK in approximately 5 seconds.
This verifies the reproduced tool-tail ordering failure; old differently ordered
checkpoints and evicted snapshots still require a rebuild. No existing user chat
or model was used as a destructive fixture. Final verify-fast passes 7,834 web
tests, 525 extension tests, type checking and all 13 coverage floors.
