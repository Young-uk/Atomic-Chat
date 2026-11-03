# Distinguish expired schedules from invalid inputs

An inference/approval delay can pass an explicitly requested start time. Never
silently shift that deadline or replay missed runs. An interval-only repeat now
starts one interval after transaction receipt; explicit starts remain unchanged.
Capture receipt time once and validate the interval before resolving its start.

Missing, invalid and elapsed start times have distinct structured validation
codes with `retryable: false` and `taskCreated: false`. Elapsed starts include
current/requested timestamps and overdue seconds. The tool catalog instructs
the model not to retry the same expired deadline or guess a replacement. This
is guidance, not a guarantee of model compliance; rejected calls create no task.
Existing cron resolution, missed-run policy and approval requirements remain.
