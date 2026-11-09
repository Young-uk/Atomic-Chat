# Strata summaries from a bound conversation clone

The personal Strata route can opt in to a full-capacity summary bank cloned from
its completed text conversation. This replaces independent 16K extraction batches
for ordinary text-only background compaction. Dstar, attachment turns and urgent
overflow recovery keep their existing paths in this first stage.

The app labels each foreground request with its thread/user-turn owner. The
cooperative client records committed input/output token IDs after a complete,
uncancelled text response. Clone admission checks both length and a deterministic
64-bit token hash against native live state. These are local race checks, not
cryptographic authentication. A different or advanced conversation is refused
before publication; the app retains its complete original archive.

After GPU quiescence and pending folds, Metal allocates independent full-capacity
KV codes/scales, pooled indexer rows, recurrent state, PLE state, QSA state and host
continuation metadata. Absolute position tables are copied separately, including
positions preserved by the existing approximate retained-history cache. Weights,
expert arena and compute scratch remain shared. Memory pressure, stable swap,
headroom and the RAM floor still gate admission. This is not a second model. The opt-in physical state/scratch allocation reserves
8192 extra cells for the clone instruction and answer; the main request limit
remains 64K. The clone bank is about 1.1GiB at 64K plus this reserve, rather than
the old 16K bank's roughly 340MiB. This is a layout estimate, not measured peak
resident memory. The configured clone budget is 1.3 billion bytes.

AFORK appends only the previously emitted but uncommitted terminal token and the
new summary instruction to that bound bank. It never sends or retokenizes the
conversation. The instruction includes short source anchors and authoritative
unfinished-work state. It restricts the handoff to the frozen older prefix and
forbids using private reasoning as remembered facts. The current context contains
reasoning; this restriction is an instruction, not structural filtering.

One summary replaces the old handoff plus newly archived older turns. The recent
20% target and complete-turn boundaries remain. The normal trigger is 60% raw
history, with the existing 85% prompt-envelope pressure trigger. Newer dialogue
remains raw, and an edited source invalidates application. The next request uses
the already implemented approximate retained-history compaction, preserving the
remaining dialogue cache and evaluating the new summary and new input.

Compute stays serialized with the existing 8:1 foreground weighting. Idle clone
instructions use ordinary physical input chunks up to 2048, reduced to one when
foreground work is pending; decode yields after each token. The clone request has
no ten-minute extraction-fragment timeout. Cancellation remains explicit. The
2048-token output cap includes the JSON work ledger; the prose target is 2000.

Native protocol discovery and app/backend/artifact pins gate the new path. The
original native/runtime binaries and disk sessions remain available for rollback.
Changing pins may require one cold foreground prefill; old disk manifests are not
rebound to a different engine. Validation uses CPU protocol/state-machine tests,
app tests and a Metal build. Real-model summary quality and clone peak memory
remain for the user's manual inference test.
