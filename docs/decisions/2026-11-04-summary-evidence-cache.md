---
date: 2026-11-04
title: "Keep summary evidence ahead of repair instructions"
---

# 2026-11-04 — Keep summary evidence ahead of repair instructions

- **Context:** Source-validation repairs replaced the system instruction, invalidating the recurrent cache before otherwise identical historical evidence.
- **Decision:** Keep the faithful-handoff instruction and evidence unchanged, and append the normal or repair task as a final user message. Count this exact wire envelope, including repair allowlists, before selecting evidence. Dstar summary requests capture an exact recurrent checkpoint before the final user task.
- **Consequences:** Identical-evidence repairs can reuse the source prefix. New evidence fragments and changed historical memory still require prefill. The dedicated summary slot retains its existing no-disk-checkpoint guard, so these disposable anchors do not evict conversation disk checkpoints. Foreground routing, thinking-disabled summarization, output limits, source validation, archives, and verified checkpoint semantics remain unchanged. Existing summary checkpoints remain compatible because evidence and memory semantics are unchanged. Older servers can process the standard messages but may not reuse the new boundary.
- **Owner:** personal fork.
- **Links:** `web-app/src/lib/dstar-context-archive.ts`; Dstar `ds4_server.c`.

## Validation

- Focused summary/repair/budget tests: 33 passed, including unchanged source prefixes during source repair and repack output-limit retry.
- `make verify`: passed (web suite 7,893 passed; native main suite 1,329 passed, 11 ignored; all remaining configured suites passed).
- Web production build and Dstar server build: passed.
- Dstar server unit suite: passed, including summary evidence-boundary and incomplete-header checks.
- Installed-app replacement and model-backed cache-hit/latency measurement remain unverified. The running app/server were not replaced by this change.
