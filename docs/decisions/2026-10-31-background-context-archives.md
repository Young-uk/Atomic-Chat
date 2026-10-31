# Background context summaries with searchable original archives

Status: experimental Personal/Dstar integration; not pushed.

## Decision

At approximately 70% of the actual context capacity, prepare a summary on a
second resident slot sharing the same model weights. Preserve roughly 20% of
full context capacity as recent original messages, expanding the boundary to a
complete user turn. Never split tool calls from results. Preserve the newest
turn even when it alone exceeds the target. Token estimates use previous actual
usage where available; this is not a tokenizer-exact 70% boundary.

Snapshot only the selected old prefix. Persist its original UI messages before
model/file transformations, including tool records, to dated JSON files under
that thread's `context-archives` directory. Write a unique staging file, sync,
read back, and rename before allowing inference; sync the directory on Unix.
Failure preserves the original model context. Original thread messages and the
visible transcript are never deleted. Archive sources are immutable; adding a
summary cannot change their source. Filenames use stored message clock ranges
and a unique ID. A missing clock is explicitly unknown, never fabricated.

Summarize user-visible evidence and actual tool records, excluding private
reasoning from the evidence. Preserve decisions, preferences, confirmed facts,
uncertainty and unfinished work. Subsequent summaries merge the previous summary
with newly archived evidence. Only a completed, nonempty summary is eligible.

Apply a ready summary at the next user turn, not between tool calls/results.
Compare the entire archived source against the current prefix first. Edits,
regeneration or stale snapshots retain original history. Appended messages
remain outside the snapshot. Reload only verified stored records; revalidate
their prefix before applying. Archives are thread-scoped and remain historical
data, never new execution authorization.

Offer `search_conversation_archive` as a local history tool, independent of web
search, on supported tool-capable Dstar chats. Search the current thread only,
deduplicate message IDs and return up to six bounded excerpts with archive/time
references. No archived tool call is replayed for execution.

## Server scheduling and resource limits

`--summary-slot` opts into two resident sessions. `atomic_summary: true` requests
are pinned to the last slot; normal requests stay on slot zero, retaining their
checkpoint. Existing executor queues and synchronization are reused. Foreground
prefill wins the next scheduling quantum; GPU work already in flight is not
preempted, and decode resources remain shared. This is not a latency guarantee.
The models endpoint advertises `atomic_summary_slot`; an older/external server
without that capability never receives a background summary.

There is additional per-slot cache memory. A 64K synthetic two-slot run must be
validated before deployment. If space runs out before a summary is ready, report
that state rather than silently dropping recent messages or sending a request
with no answer room. This does not eliminate all context-limit cases (for
example, a single oversized tool result).

## Required validation

Archive write/verification failures, empty summaries, stale edits, restart,
messages appended during summarization, complete-turn boundaries, private
reasoning exclusion, bounded thread-only search, dedicated-slot routing and
foreground streaming before summary completion. Keep synthetic model tests
separate from real-user transcript validation. No push is implied by deployment.
