# Restart a failed owned Strata runtime

After a Metal GPU timeout, the native model exited while the Python listener stayed alive. Health reported `loaded: false`; status reported an idle `recovery_required` transaction. The actor previously checked only the Python child exit and stopped probing after first readiness.

The native controller now checks health every two seconds after readiness. An explicit unloaded response must be followed by an owned status reporting recovery required and zero foreground, summary, reserved, and HTTP work. It uses the existing authenticated drain and shutdown-only barrier before stopping, reaping, and launching the same engine/context. A slow, unreachable, healthy, loading, busy, or foreign service is not sufficient evidence. Unexpected exit of an already-ready owned Strata Python child also queues a replacement through the normal no-overlap launch checks.

At most three automatic restarts occur in a rolling ten-minute window. Repeated failure pauses recovery with a translated error; explicit stop, shutdown, and engine switching do not schedule recovery. Native/backend/model qualification and disk-cache admission remain unchanged. No conversation or tool request is automatically replayed: external effects of a partially completed turn cannot be assumed undone.

Validation uses an isolated HTTP server owned by the real child process: loading and busy responses, failed authentication, authenticated poisoned shutdown, same-context replacement, parent exit, restart limit, and absence of chat replay. Existing ownership/lifecycle tests and full verification remain required.
