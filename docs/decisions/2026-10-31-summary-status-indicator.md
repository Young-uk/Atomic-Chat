# Thread-scoped background summary status

Status: implemented locally; not published.

Display background summary status above the conversation composer, separately
from foreground inference progress. Publish archive preparation, summary request
in flight, saving, ready and failed from the existing compaction lifecycle.
Show elapsed wall time and actual completed fragment count in expandable details.
Ready disappears after five seconds; failure remains until the next attempt.
Only claim the archive is saved after its durable save succeeds. Cancellation
removes the indicator and stale task callbacks cannot replace a newer task.

The server currently does not publish GPU queue/pause events. Therefore an
in-flight summary includes server waiting time; do not label it GPU-active or
paused based only on foreground chat activity. The total fragment count depends
on each previous generated summary, so do not fabricate a denominator, percentage
or ETA. This change observes existing work; request payloads, scheduling,
summary instructions, archive files and compaction thresholds are unchanged.
