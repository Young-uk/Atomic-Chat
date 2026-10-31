# Preserve open work separately and follow through on tool-dependent updates

## Problem

A native conversation ended with an announcement that the model would check a
weather forecast. Server diagnostics confirmed a normal stop with zero tool
calls: the client did not lose a search result. Prose summary guidance also
asked to retain unfinished work, but did not store a separate durable ledger.

## Decision

Keep the original v1 tool-progress policy immutable. New user turns record a
v2 event that supplements natural progress updates with explicit same-turn tool
follow-through. The model still decides whether a tool is necessary; there is
no phrase matching, tool execution inferred from reasoning, or fixed utterance.
Existing approval gates and current tool allowlists remain in force.

New compaction jobs ask for structured handoff prose and work-item updates.
Store source-backed open requests and cited visible resolutions independently
from prose and inside durable checkpoints. Omission does not resolve an item.
Prose repacking never changes the ledger. Render open work as historical data
alongside the handoff; it grants no execution permission. A legacy active
summary without a ledger is refreshed after a successful turn, in background,
using its complete archived prefix. Foreground chat retains priority.

Classification still relies on the model. Source-ID and quote validation make
updates auditable, but cannot prove that every request was discovered or that
a quoted sentence logically completes it. Reject invalid/incomplete structured
output and retain the prior archive/checkpoint instead of accepting data loss.
The input budget remains strict; a ledger too large for it fails safely rather
than silently dropping work. This does not create unlimited conversational memory.

Cache diagnostics add only structural regions around a prefix mismatch (system,
user, assistant, reasoning, answer, or tool markers). They do not log private
reasoning, raw differing bytes or prompt text, and do not relax cache matching.

## Validation

Track mocked invariant tests, full verification, live model behavior and actual
installed-app replacement separately. Prompt strengthening alone is not proof
that every model response will call a tool; preserve any failed reproductions.
