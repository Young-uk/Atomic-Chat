# Allow full 64K Personal cache checkpoints

The user approved increasing Personal Dstar's disk KV limit from 2 GiB to 4 GiB.
A real 63,933-token shutdown snapshot measured 2,194.84 MiB, or 2,216.78 MiB
including the writer's safety margin. The old 2,048 MiB limit skipped saving it,
so restart could only reuse an earlier partial prefix. The existing per-model
cache directory is unchanged. This is a disk-space ceiling, not model context
size or an extra resident-memory allocation. Dstar's pending-restore eviction
protection is a separate server change.

A clean checkout also exposed missing vendored archive tool sources: the broad
existing archive/ ignore rule excluded them from the earlier push. Restore the
already deployed, previously tested source files verbatim and add a narrow ignore
exception for this source directory. No archive algorithm or dependency changes.

Validation uses the existing verification gate and Personal build. Model-based
cache tests use a separate port and cache directory with synthetic input; never
populate production KV storage with QA conversations.
