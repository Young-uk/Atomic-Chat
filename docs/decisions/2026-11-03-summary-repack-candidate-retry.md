# Retry oversized historical summaries using the completed candidate

Historical repacking previously retried the same original input with identical
bounded guidance. Deterministic generation could repeatedly return the same
slightly oversized handoff and fail despite normal completion.

Keep the existing three attempts and byte budgets. When a complete, nonempty
handoff exceeds the output budget, use it as the next compression input if the
full retry envelope fits. Truncated outputs are never used as candidates. No
source records or request ledger entries are deleted, and evidence progress is
not advanced until a valid result is available.

A regression test checks a multilingual oversized candidate and verifies that
the second request compresses that candidate with reasoning disabled. Installed
application and real-model verification remain separate from mocked tests.
