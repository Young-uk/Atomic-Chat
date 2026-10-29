# Verify model replacements before publishing

## Context

Upstream v2.2.29 reuses a completed file only after checking its supplied hash, and downloads it again when that hash differs. The personal fork also protects existing completed files. Its size-only early return bypassed the upstream hash-aware path, so repair did not run.

## Decision

Keep size-only resume reuse when no hash is supplied. When a hash is supplied, use the upstream hash-aware check. A replacement downloads into the existing temporary-file workflow while the old completed payload stays in place. Before any single-stream, completed-partial, or segmented transfer renames over an existing payload, validate the temporary payload against the supplied hash and size and check cancellation again. Publish only after success; preserve the old payload and recovery files on failure or cancellation.

Carry verification status to the task coordinator so it does not repeat an expensive hash read after publication. Verified files still enter owned-sidecar cleanup. Cleanup called by a transfer uses its existing path-writer ownership rather than waiting on that same operation again.

This changes corrupt-file repair behavior from the personal fork's preserve-and-error result to verified replacement, with explicit user approval. It does not change app update policy.

## Verification

Use temporary fixtures for valid replacement, invalid replacement over both single-stream and segmented transfers, cancellation before publication, and verified reuse with sidecar cleanup. Existing model files and external storage are excluded from validation runs.
