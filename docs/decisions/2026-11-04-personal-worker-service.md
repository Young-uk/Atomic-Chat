# Opt-in Personal background worker

Personal tasks and watches previously belonged to the stdio MCP process and
stopped when Chat disconnected. Keep the default app-connected lifetime, but
allow a user-operated macOS login agent to keep the same worker alive.

All stdio clients now connect to a per-user, per-data-directory Unix socket.
The socket is bound before constructing stores or reconciling tasks, so only one
worker owns scheduling, watches, native proposals and browser state. A second
client does not open another store. Socket directories are owner-only and socket
files are mode 0600. Permission errors do not trigger fallback to a second worker.
A refused socket may be recovered only if it is an owned socket inode.

The login agent is a holding client, not another scheduler. App disconnect leaves
it running; stopping it leaves an app-connected worker intact. The last client
leaving triggers orderly worker shutdown. Registration and activation occur only
from explicit settings actions. Installation does not register or enable it.
`chat.atomic.personal.worker.plist` preserves the configured loopback endpoint,
model and workspace without copying unrelated environment secrets.

This does not grant new native tool approvals, run arbitrary tool workflows,
prevent sleep, keep Dstar loaded, or provide notifications while Chat is closed.
Scheduled results remain in the existing durable outbox for Chat delivery on
reconnection. Background tool workflows and external channels need separate
permission and delivery ownership before they can use this infrastructure.

Validation must include two simultaneous transports, reconnect/persistence,
default-off settings, login registration, and closing either client independently.
Actual login-agent activation is separate from isolated protocol tests.
