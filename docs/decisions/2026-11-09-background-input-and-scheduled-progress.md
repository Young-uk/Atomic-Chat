# Background input blocks and scheduled task progress

Status: accepted

An idle uncached background request used 128-token input turns even without competing conversation work. Scheduled reminders shared this summary path and were also aborted after three minutes, so reading their assistant instructions could consume the whole deadline.

Remove the server's legacy idle throttle: idle background requests use the current native input capacity (currently 2048). Preserve weighted compute turns and resident caches. Ordinary summaries yield with one input when foreground work exists. Scheduled text tasks carry atomic_background_task:true and retain 512-input turns during foreground activity; this is a per-turn block, not a total request limit. Recovery retains its existing urgent priority. Old native protocols remain bounded by their explicitly advertised capabilities.

Scheduled work has no default wall-clock timeout. Explicit caller deadlines, user cancellation, engine failure, context capacity, and the requested short output budget remain effective. Existing failed/missed occurrences are never replayed. Delivery already polls at application scope without waiting for an active chat response to finish.

The audit distinguishes unrelated 128 values: Dstar's optional mixed-batch default, legacy native protocol capability declarations, output buffer sizes, progress reporting intervals, architecture dimensions, and tests. These are not an idle background throttle and are unchanged. Normal single-request chat does not use summary input scheduling.

Validation uses CPU scheduler/protocol/cache tests, fake inference and cancellation tests, full app verification, and offline GUI qualification. Model inference tests remain user-owned.
