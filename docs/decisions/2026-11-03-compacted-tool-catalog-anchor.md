# Preserve the original tool catalog across compaction

Compaction used to remove the first catalog-bearing user turn. Re-expanding
only the retained turns promoted a newer catalog to the leading system region,
invalidating the fixed KV prefix. Replay the original history's first catalog
and its original preamble policy without its archived user text, then expand
retained changes in order. Historical snapshots remain immutable; the current
API tool allowlist still controls execution. No original messages are deleted
or migrated. Restart uses the same durable hidden metadata.

This preserves the original catalog prefix, not the KV state of discarded
conversation tokens. A summary can still require replay of retained dialogue.
