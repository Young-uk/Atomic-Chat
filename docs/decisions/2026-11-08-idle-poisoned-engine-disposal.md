# Permit shutdown of an idle poisoned engine

## Context

The foreground APREP reader did not accept the legacy REUSED marker. Normal
prompt completion or cancellation could poison priority ownership. The generic
error incorrectly named summary restoration even before a summary ran. Stop
and switching then required successful summary restoration, trapping the user.

## Decision

Accept and validate both RESUME and REUSED counts through the tagged APREPARED
boundary. Preserve strict identity, progress, cancellation and unknown-line checks.

An authenticated owner drain may arm recovery_stop_ready only when no foreground
request, pending or active summary, inference reservation, live/queued request,
or scheduler owner/waiter remains. It closes inference admission atomically.
The runtime stays poisoned and cannot resume; rollback_pending remains true.
This is permission to dispose of the owned process, never evidence of restored
state or permission for more inference. The native manager rechecks the barrier
and all request counters, signals its owned process tree, and waits for every
owned member to exit before launching a replacement. User conversation records
and settings are not changed.

Dstar Start now goes through coordinated quiesce and switching. Independent
managed Stop enforces the same barrier even when another chat model is selected.

## Verification

Fake native REUSED completion/cancellation regressions reproduce the original
failure and pass after the fix. CPU API tests reject disposal with outstanding
request/scheduler ownership and verify poison cannot be resumed. Rust tests
check explicit disposal acknowledgments, busy/malformed states, owned listeners,
and Dstar switching via a model-free fixture. No model inference is requested.
