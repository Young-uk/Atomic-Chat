# Wire optional semantic memory and idle consolidation

The user approved preparing the remaining Agent capabilities with model/account
connections deferred. This increment connects the copied embedding store/writer,
existing hybrid ranking, query-rewriter and consolidator/link-generator sources.
It does not claim that collaboration, remote channels or closed-app execution
are implemented.

Personal feature settings are versioned and atomically written with mode 0600.
Every new feature is off by default. Embeddings require an explicitly configured
loopback OpenAI-compatible endpoint, model and dimensions. No model is downloaded
or started. The source hybrid algorithm, similarity gates and ranking defaults
are unchanged; transport/model errors degrade to FTS5. Existing notes are backfilled
only on an explicit bounded indexing call. New notes use the source writer.

Optional reference-query rewriting sees only eight visible user/assistant text
snippets (400 characters each), not reasoning. It has a 500 ms budget and retains
the raw query on failure. The existing 750 ms best-effort host recall deadline,
immutable per-turn snapshot and stable system prefix are unchanged. Old snapshots
are never regenerated when a feature is enabled.

Optional link formation and consolidation share the existing Dstar background
slot and Chat idle lifecycle. The source consolidation defaults (six-hour cadence,
24-hour cooling period, at least three related notes, at most five clusters)
remain intact. Successful consolidation creates lessons/procedures and archives
source notes; originals stay addressable by id. New foreground work aborts the
background inference. No autonomous tool execution, external delivery, model
process or service installation is introduced.

The configuration endpoint is host-only and excluded from both model discovery
and the separate native Agent runner. Tests use synthetic notes and injected
vectors/completions. Live external models/accounts are deliberately unconfigured.
