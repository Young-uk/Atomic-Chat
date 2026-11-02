# Size background summary fragments by rendered tokens

The user approved a 16,384-token dedicated summary slot and actual-token input
packing. The previous slot was 8,192 tokens, while a conservative UTF-8 byte
budget and a 2,400-code-point cap often sent only 1,300–1,700 actual input tokens.
Each sequential merge generated a new handoff and ledger, making many small
fragments expensive.

## Decision

Dstar advertises the 16K summary context and a CPU-only token-count endpoint.
Counting uses the same chat parser, template and model tokenizer as inference;
it does not enqueue a job, allocate a new model, or alter a slot's KV state.
Chat opts in only when the server advertises both matching capabilities. Older
servers retain the prior 8K byte-bounded path. Invalid counts fail without
applying a partial summary.

Reserve 2,048 output tokens and 1,024 safety tokens. Binary-search consecutive
evidence against a maximum 13,312 rendered input tokens, counting the complete
instruction/previous summary/open-request/evidence envelope. Recheck the final
request, including source-repair instructions. Token counts need not be strictly
monotone at BPE boundaries; the final check remains authoritative. Output-limit
retries halve only the current fragment and remain bounded.

The historical handoff still has a separate 3,500-byte compactness bound and
the same output guidance; it no longer inherits the smaller legacy byte-input
envelope cap. Original records, recent raw dialogue, pending-work evidence,
foreground priority, and transactional checkpoint/save semantics are unchanged.
The evidence/key semantics are unchanged, so verified checkpoints can resume
with larger subsequent fragments rather than restarting old work.

## Validation

Cover complete evidence reconstruction, larger-than-2,400-character fragments,
actual whole-input limits, invalid counts, checkpoint resume, unresolved work,
legacy fallback, server slot routing, and installed-model measurement. Increasing
the summary slot increases its KV allocation; measure RSS and foreground response
behavior before claiming a performance improvement. No new model is loaded.
