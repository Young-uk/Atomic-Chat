# Chat file paths and suspend-aware reasoning time

Personal document reading, directory watches and read-only Git queries now receive
the actual originating chat id from the dispatcher, as syntax verification does.
Relative paths use agent-workspace/chat/<thread id>; calls without chat context
retain the shared root. Absolute paths still pass each tool's original realpath
workspace checks. Watch definitions persist resolved absolute paths, so restoration
never depends on a later chat's context. No file search or approval change.

The reasoning panel previously subtracted its start timestamp from the current
monotonic timestamp. A suspended webview could therefore label several sleeping
hours as thought. Accumulate observed timer intervals instead, excluding gaps
longer than five seconds. This also excludes long UI stalls and cannot distinguish
sleep from a blocked UI. Normal one-second updates and wall-clock changes retain
the prior behavior. Existing stored durations cannot be corrected without evidence
of their sleep interval and are not rewritten. This is display timing only, not
an inference timeout or a model-progress measurement.

Tests cover the actual stdio document/Git/watch routes using chat-local fixtures,
legacy verification, workspace escapes, a simulated six-hour suspended timer,
and normal timer/wall-clock behavior. No user data or power settings are changed.
