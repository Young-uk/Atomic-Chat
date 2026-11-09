# Bootstrap clone summaries from restored disk sessions

## Problem

A restored native conversation had no in-memory clone owner after restart. A normal completed foreground response recreated that receipt, so startup summary requests could not use the restored cache.

## Decision

Persist the completed foreground owner, committed token count, native token hash and uncommitted terminal token atomically in the existing disk manifest. Attest the completed semantic UI history with a SHA-256 digest through the existing authenticated, same-origin JSON API. Only the matching current native owner can receive this hash; no transcript text is sent. Bind this receipt to the exact session file SHA-256. Restore it only after native restore succeeds with the same token count and file digest. Native FORK still verifies committed tokens and hash before copying state. Interrupted, image, mismatched and legacy sessions do not acquire a fabricated owner.

Expose only the restored owner in the existing authorized status response. Before the first foreground request, the managed clone-capable frontend verifies that owner against the previous completed turn, that the saved semantic history digest matches the current completed transcript, that the server is idle, and that the projected view is text-only. Apply the existing tokenizer-based 60% raw-history or 85% envelope-pressure trigger. If required, await one clone handoff before sending the pending user question, preserving original messages and the recent complete-turn tail.

A reviewed backend-only migration permits the previous backend pin while keeping native and model pins exact. Future saves publish the current identity. The existing old manifest has no receipt: its cache remains usable for ordinary inference; direct startup cloning begins after the new version saves a completed request. No native layout change or new model generation test is introduced.

## Validation

Disk-session, native protocol mock and scheduler regression tests; frontend startup and stale-owner tests; full repository verification. Actual model inference remains user-driven. Build and installation status are recorded separately.
