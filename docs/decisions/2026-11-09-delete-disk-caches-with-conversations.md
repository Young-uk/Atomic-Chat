# Delete native disk checkpoints with their conversations

Status: accepted

## Problem

Deleting a conversation removed its messages but left engine disk checkpoints. The old files did not identify their conversation, so they could not be reclaimed precisely. The user requested a one-time full cache reset and ownership-based deletion for future checkpoints.

## Decision

Attach a bounded conversation ID to each native checkpoint in a small `.threads` sidecar. Keep the KV/session payload format and cache matching unchanged. Dstar records owners on partial and full cache publication, including shared prefix reuse. The outgoing resident owner is preserved until its eviction checkpoint is saved. Strata records the foreground owner independently of summary clone attestation and persists it across ordinary disk restore.

The desktop delete command publishes a per-cache-directory conversation tombstone before removing that conversation's files. Delete a shared checkpoint only once all its owners have been deleted. Writers check tombstones before and after publication, so shutdown or an in-flight request cannot resurrect deleted checkpoints. Delete associated latest-session manifests and clone receipts. Never derive a path from an unrestricted owner or sidecar filename, follow a symlink, clear other conversations' caches, or change normal backend inference policy.

Only the managed personal Dstar and Strata caches participate. Unowned third-party caches keep their existing lifecycle. Existing cache files were explicitly cleared once; no heuristic mapping from old conversation text is used.

## Validation

Model-free tests cover multi-owner checkpoints, traversal rejection, idempotent deletion, Strata manifest cleanup, ordinary restore ownership, and deletion during publication. Native build/frontends and the app verification suite are required. Actual model inference remains user-driven.
