# Start background summaries after the complete foreground turn

Status: implemented locally; not published.

Previously transport preflight scheduled a summary before sending the answer.
This could put background prefill ahead of the foreground request. Move the
70-percent decision to a successful terminal `stop`, include the completed
assistant response, and use that response's measured usage when available.
Tool-call steps, aborted requests, errors and output-limit finishes do not
schedule a new summary. A ready summary still applies only at the next user turn.

An endpoint-scoped foreground lease is acquired before tools/readiness/preflight.
Keep it across client tool continuations; release on terminal stream completion,
error or cancellation. Other chats on the same endpoint share the lease count.
Independent endpoints do not block one another.

Foreground arrival aborts only the in-flight summary HTTP fragment and shows
paused status. Await the end of all foreground leases, then retry exactly the
same evidence fragment with the last completed summary. Completed fragments,
source archives and recent messages remain unchanged. Real network errors and
explicit whole-summary cancellation retain their existing failure behavior.
No server/model scheduling, summary instructions, thresholds, retention
fractions or model parameters change. Already executing GPU work can take a
short cancellation quantum to stop; the UI does not claim instantaneous GPU
preemption. Per-request abort reaches the server's existing disconnect watcher.
