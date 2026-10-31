# Reject unsupported summary resolutions without aborting compaction

A real legacy conversation failed after 21 durable sections because a model
claimed completion without an exact visible evidence quote. The model finished
normally; the ledger validator aborted the whole summary transaction.

Keep exact source/quote checks. Ignore each unsupported resolution, retaining
its existing open item and accepting independently valid updates. Do not weaken
validation of newly invented source IDs, malformed JSON, incomplete envelopes,
or truncated model output. Such errors still fail safely. Previously completed
checkpoints and original archives remain authoritative. No model guidance,
input budget, output limit, scheduling, or retry threshold changes are made.

Validation must include mixed valid/invalid resolutions, newly opened items,
checkpoint persistence across multiple fragments, and replay from the actual
failed legacy checkpoint. The original conversation must remain intact.

## Additional source repair approved after native replay

Native replay progressed from section 21 to 23, then found a separate error:
the model attributed a new request to a real assistant message. Do not accept
or relabel that source. The user approved up to three additional model repair
attempts for the same fragment. Supply an explicit user-message ID allowlist,
keeping the original evidence and previous ledger fixed. Validate again before
advancing the offset or saving; exhaustion retains the previous checkpoint.
The repair uses the same bounded summary slot/input/output budgets and idle
scheduler. Normal instructions and checkpoint keys remain unchanged so valid
previous progress is resumable. Malformed JSON and incomplete envelopes still
fail safely. Unsupported completion claims continue to be ignored independently.

## Verification on November 1

Focused regression tests: 44 passed. Sequential verify-fast passed (7,798 web
tests and 525 extension tests; 26 skipped), including coverage, type and lint
checks. Native tests passed (1,553) after rerunning with local bind permission;
the initial restricted run could not bind local sockets. Personal release build
and installed signature verification passed.

Native replay resumed the real 52-message archive, advancing past both previous
validation failures to section 35, offset 47,397 of 47,404. Original archived
sources match the prior archive exactly. It did NOT complete: the combined
summary, open-request ledger and instructions exhausted the 5,632-byte input
budget. The summary alone was 3,185 serialized bytes, below the repack target,
so existing repacking did not free envelope space. Final summary remains
uncommitted; all prior checkpoints and original messages are retained.

A full standalone replay previously timed out under memory pressure while web
tests ran concurrently; it is not counted as successful completion. Sequential
checks and native replay replaced that overlapping validation approach. Restart
disk-cache restoration was independently observed (40,960 cached tokens).

Remaining work requires envelope-aware repacking; user approval was requested
separately because it changes the summary reduction target. No commit or push
was made for these fixes.

## Envelope-aware reduction approved

The user approved reducing prose against the complete serialized input envelope.
Calculate the prose target from the existing 4,000-byte envelope reserve after
accounting for instructions, offsets and the unchanged open-request ledger,
capped at the existing 3,500-byte prose target. Pass that target through repack
validation and output guidance. Preserve ledger entries and original evidence;
if the ledger alone cannot fit, fail explicitly without discarding obligations.
Checkpoint keys, output limits, source validation and scheduling remain unchanged.
A regression reproduces four retained requests plus 3,182 bytes of prose, verifies
repack occurs, and confirms the final evidence and all four obligations survive.

The first envelope-change verify-fast run passed all 7,799 web assertions but
reported a late React state update from CodeBlock after test environment teardown.
Replace the inverted shared mounted flag with effect-local cancellation so old
highlight promises cannot update an unmounted block or overwrite newer inputs.
This lifecycle correction does not change summary or model behavior.

## Final native archive completion

After envelope-aware reduction, verify-fast passed without unhandled errors
(7,799 web assertions, extension suites and all 13 critical coverage floors).
The Personal release build completed in 5m18s and its installed signature passed.
Installed executable SHA-256:
`0511c0eeff09d30f57f438ffb441ad290742afaf357d69ee54b78e5b2f1a5c07`.

Native replay resumed section35 at offset47,397, repacked the prose, and committed
section36 at47,404. Both final summary and independent request ledger are saved;
all four open requests remain, and all52 original source messages exactly match
the prior archive. UI returned READY and showed no summary error after completion.
This verifies the actual formerly failing archive; it does not establish fidelity
of every summarized fact or guarantee all future model-generated ledgers succeed.

The following native user turn also completed with READY, without a context-full
or response error. Its prompt missed cache and reread 50,982 tokens, taking
approximately six minutes; this fix does not claim to resolve that cache miss.
Post-answer background summarization scheduled again for the newer history.
The user's prior active chat was restored, leaving the SSD64K server running.
