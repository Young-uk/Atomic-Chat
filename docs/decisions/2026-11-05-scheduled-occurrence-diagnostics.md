# Scheduled occurrence timing and interruption diagnostics

## Context

A one-shot reminder accepted an offset-bearing ISO timestamp only after the model
removed its explicit IANA timezone. Its occurrence later finished with the opaque
error `This operation was aborted`. The machine slept during the interval; the
persisted record had only a finish time, so it could not establish when execution
actually started. Finish time must not be presented as start time.

## Decision

Accept and validate an explicit IANA timezone for one-shot and interval tasks as
well as cron. The offset in `at` continues to determine the absolute due instant;
the IANA zone controls execution-time presentation. Save the occurrence's due,
start and finish times separately. Keep existing records readable with a null
start when it was not recorded. Identify timeout, cancellation and worker shutdown
with distinct messages. Preserve the three-minute timeout, recurrence policy,
missed-run policy, human approvals and the separation of generation from delivery.

## Limits

This does not wake a sleeping Mac or silently replay missed work. An old opaque
abort cannot be retrospectively classified conclusively. No existing failed task
is rewritten or rescheduled.

## Verification

The Personal tools suite passed 66 tests, including one-shot timezone retention,
occurrence timestamps, timeout cause, cancellation and recurring failure behavior.
The full `make verify` gate also passed, including 7,925 web tests and 1,329
application-native tests plus the platform-supported plugin suites. Installed
runtime replacement and real notification delivery have not been verified here.
