# Resumable Dstar streams

The Personal Dstar path uses an optional versioned `/v1/atomic/streams`
transport. Standard providers retain their existing OpenAI transport. The
registered Dstar URL is passed explicitly because normal custom providers use
the Atomic core proxy; probing the proxy would miss the Dstar capability.

A random request ID binds one immutable request to one inference job. The server
captures SSE through a local socket pair and retains exact response bytes in
private temporary files. A disconnected consumer reconnects with a byte cursor;
it does not repeat model inference or client-side tool execution. Manual Stop
sends DELETE, including a tombstone for a cancellation preceding the POST.

The native client retries interrupted connections at 1, 2, 4, 8, 16, 32 and then
64-second intervals, resetting after data arrives. Known Personal Dstar endpoints
also wait for connectivity before their capability probe. Explicit HTTP errors,
expired requests and server restarts are surfaced, rather than replaying partial
answers or tool operations. Model failures are separate from network failures.

Retention is bounded to 16 MiB of response per request, 128 MiB across retained
request bodies and responses, 24 hours after completion, and 4096 request IDs per
server lifetime. Capacity exhaustion fails explicitly. Registry IDs remain as
tombstones until shutdown, preventing an expired ID from generating again.
Normal shutdown removes temporary files. An app restart is outside this initial
in-flight recovery scope; neither conversation files nor model/KV files change.

Validation must cover interrupted UTF-8 and tool frames, cursor continuity,
manual cancellation and missing generations. A synthetic disconnect test does
not prove physical laptop sleep or a deployed model request.

## Follow-up: emergency summary progress

A real archived conversation reproduced a distinct preflight failure: its normal
recent-history boundary equaled the existing 140-message archive, while tool
catalogs and fixed instructions made the projected prompt exceed 64K. Emergency
recovery now advances across complete older user turns using the measured input
overflow plus 1024 tokens of headroom. The newest user turn and all its tool work
remain raw. Normal post-answer background compaction keeps the 20% target.
Read-only replay uses synthetic summaries in memory and never rewrites the real
conversation or its archives.
