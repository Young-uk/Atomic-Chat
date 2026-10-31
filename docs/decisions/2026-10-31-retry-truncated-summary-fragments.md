# Retry truncated summary fragments with bounded smaller merges

Status: implemented locally; not published.

A real 64K conversation recovery failed when the second summary merge reached
its 768-token output limit. Never accept that partial summary. Retry the same
evidence offset with the last completed summary, halving the fragment cap from
2400 code points to 1200, 600 and 300. Use the same 1000-token handoff guidance on every attempt; do not tighten it
to 300 tokens after a failure.
Only output-limit finishes trigger this policy; HTTP, empty output, cancellation
and other finish reasons retain their existing failure behavior. Four attempts
per fragment bound repeated failures. Input serialization stays within 6000
UTF-8 bytes and output is allocated from the remaining 8192-token slot after a conservative
serialized UTF-8 input-byte bound and a 512-token template reserve, capped at
2048 tokens. The 6000-byte input cap guarantees at least 1680 output tokens.

Advance the offset and publish completion only after a normal stop with nonempty
content. Preserve all original archive records, complete prior merges and recent
raw turns. Normal 70-percent scheduling, retention and foreground priority do
not change. Smaller evidence and concise summaries can omit incidental
detail; searchable source remains the authority for recovering such details.
