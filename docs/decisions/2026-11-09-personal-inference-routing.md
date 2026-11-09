# Personal inference follows the originating local runtime

Status: accepted

Scheduled tasks previously used the connector-wide Dstar URL and model even when their originating conversation used Strata. The scheduler fired correctly, but generation failed immediately when Dstar was stopped.

At creation, resolve the thread's current model against an application-written context usage scope and persist the exact managed local endpoint/model with the task. Never use model-authored message text as routing authority. Execution validates the saved runtime's background-slot capability and advertised model, and never redirects a saved task to another runtime. Older pending tasks without a routing snapshot resolve their originating thread; failed/missed occurrences remain unchanged and are not replayed. A thread without a matching verified scope receives an explicit error instead of an unrelated default model.

Reflection follows its active originating conversation. Query rewriting and unscoped memory maintenance select a single available background-capable local runtime; an unavailable or ambiguous choice fails explicitly. Probe catalogs concurrently, bound each probe, honor cancellation, and never start an engine. Explicit administrator-configured custom loopback endpoints remain supported for unscoped work; conversation snapshots accept only the two managed local services.

Tests cover Strata routing without Dstar, unavailable or changed saved models, ambiguous memory routes, thread traversal/external endpoint rejection, task persistence and worker reconnect delivery. Live validation only reads the current model catalog; generated model tests remain user-owned.
