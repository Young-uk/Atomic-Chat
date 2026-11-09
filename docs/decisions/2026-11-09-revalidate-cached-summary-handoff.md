# Revalidate cached summary handoff against the latest conversation

## Context

A cloned summary freezes its evidence while foreground dialogue and tool results continue. Planning only at clone creation does not validate the eventual handoff against the latest committed native cache. The observed handoff fell back with `no-aligned-retained-run` and reread 35,136 input tokens. The old frontend also omitted persistent diagnostics for refused or failed planning requests; the exact initial planning outcome is not recoverable from those logs.

## Decision

Before adopting a ready cloned summary on a new user request, repeat the existing tokenizer-only whole-turn planner using the most recent completed foreground owner and current sanitized model view. Do not run this check inside tool continuations. Native matching and budget guards remain authoritative; no inference or native cache mutation is introduced by planning.

A newly selected earlier boundary is stored as optional `cacheRetainFrom`. The complete immutable `source`, generated summary and request ledger remain unchanged. This deliberately keeps a few already summarized turns as raw overlap rather than rewriting archival evidence or dropping newer dialogue. The planner may never move beyond the existing boundary or back into an already active archive. Legacy records without this field keep their existing behavior. Persist the overlap before adoption; cancellation and changed evidence must not adopt an asynchronous result.

Count-only planning results, HTTP refusals and exception classes are persisted in the existing application log. Never log dialogue, tool arguments or raw error messages. No new locks, permissions, dependencies, model calls or backend qualification changes are required.

## Validation

Regression tests cover foreground dialogue and tool results arriving during summary work, immutable source evidence and ledger placement, earlier raw overlap, rejected later/fragment/zero boundaries, cancellation, edited evidence and ordinary fallback. Run the required repository verification. Real model inference and cache reuse rates remain for manual validation by the user.
