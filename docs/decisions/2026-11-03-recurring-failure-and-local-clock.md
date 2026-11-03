# Separate failed occurrences from recurring schedule lifecycle

A two-minute cron stopped permanently after a three-minute inference abort.
The failed occurrence also entered the normal delivery outbox, and execution
instructions supplied only UTC despite an Asia/Seoul schedule.

Keep occurrence errors in run history, skip result delivery for generation
failures, and advance repeating tasks to the next future firing. Intervals remain
on their original due-time grid; do not replay missed occurrences. Explicit
cancellation still wins races. One-shot failures remain failed. Supply the
schedule's IANA time zone (or the host zone for non-cron tasks) as the execution
time and date-template zone, with UTC only as a labelled reference.

Do not revive existing failed, missed, or cancelled tasks as a migration. Existing
delivered history stays intact. Regression tests use isolated stores and mocked
inference; no production schedule is created or re-enabled by validation.
