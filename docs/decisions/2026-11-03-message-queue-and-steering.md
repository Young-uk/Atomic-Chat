# Message queue and explicit steering

Composer submissions enter a per-thread FIFO held in session memory. While a reply is active, Enter and the queue button append a message; queued text can be edited, removed or reordered. Attachments are captured before clearing the composer, and delayed sends must not clear the next draft's attachments. The queue is retained across route navigation in the current app session, but is not persisted across app restarts. A queue drains only while its thread page is mounted.

Send now prioritizes the selected queued message, cancels the current SDK or agent request, and waits for idle state before dispatching it. This is a new request with the retained transcript, not mutation of an in-flight inference request. It never regenerates earlier turns or explicitly repeats previous tool calls. Cancellation cannot undo external tool effects already performed. A manual Stop or request error pauses automatic draining; resuming is explicit.

A synchronous store claim prevents rapid Enter presses and rerenders from starting overlapping sends. Window-state tool changes remain separate from this interaction change. Unit tests cover FIFO, per-thread isolation, exclusive claims, attachment retention and queue controls. Composer and browser layout checks complement the repository verify gate. Real-model interruption remains a separate deployment check.
