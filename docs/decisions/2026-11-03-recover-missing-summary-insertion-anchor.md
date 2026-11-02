# Recover a missing summary insertion anchor

A persisted conversation had a verified 118-message summary whose insertion
message ID was absent after reload. The source prefix still matched, but apply
returned all raw history when the insertion anchor was missing. Emergency recovery
then found no new eligible prefix beyond the active archive and reported
"No earlier complete turns are available to summarize" before model inference.

For a matching source prefix only, recover the anchor at the final archived
message. This inserts historical summary data before the retained raw dialogue,
never after the current question. Persist the recovered anchor for subsequent
requests. Edited archived content continues to invalidate the summary, and no
original messages or archives are discarded. Normal valid anchors stay fixed.
The first repaired request can invalidate part of the prior prompt cache because
its model-bound layout changes; later requests retain a stable boundary.

Validation covers a missing transient anchor, exact retention of recent raw
messages, persistence, and rejection of edited archived content. An opt-in local
replay test reads existing conversation/archive files without writing them or
including their contents in repository fixtures or logs.
