---
date: 2026-11-04
title: "Preserve continuation prefill across context recovery"
---

# Preserve continuation prefill across context recovery

- **Context:** Preparing a continuation consumes its pending assistant prefill. If preflight or the provider rejects the prompt before output, emergency compaction retries the request without that prefill, losing previously streamed answer text.
- **Decision:** Snapshot the continuation at the logical request boundary and restore it only for the existing single pre-output context-recovery attempt. Keep normal one-shot consumption and never replay an already visible stream or executed tools.
- **Consequences:** The recovered request includes the prior answer and the existing stream adapter restores it exactly once. Later unrelated requests do not inherit it. Compaction may still require prefill computation; this preserves answer continuity rather than promising an uninterrupted backend generation. Reasoning/tool-state continuation and arbitrary midstream errors are outside this narrow fix.
- **Validation:** Regression coverage checks both local overflow and provider rejection, exact visible answer preservation, assistant prefill, and no leakage to the next turn. Installed-app reproduction is separate.

## Verification results

- Transport harness: 65 tests passed, including both continuation-recovery cases.
- `make verify`: web/type/lint/quality checks passed. The initial native main run timed out in the unchanged trickling-download test (1,328 passed, 1 failed, 11 ignored).
- `make test-rust` rerun: all configured native suites passed, including the main suite (1,329 passed, 11 ignored) and the previously timed-out download test.
- `git diff --check`: passed.
- This follow-up has not been built into or installed over the running application. Real-chat UI continuity remains to be verified after installation.
