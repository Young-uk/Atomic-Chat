---
date: 2026-10-27
title: "Keep the personal integrated build separate from contribution branches"
---

# 2026-10-27 — Keep the personal integrated build separate from contribution branches

- **Context:** The download, message-clock and image-observer fixes are submitted independently. The user needs one locally usable app containing all three and the loopback-stream core fix. The upstream app currently pins core 0.19.0, while the refreshed core fix is based on 0.19.1.
- **Decision:** Combine the app fixes on `personal/integrated-oct27`, preserving all submitted branches. Pin this personal branch to core 0.19.1 and bundle both host binaries built from core commit `988d5306aaa3bd38b9cae3c7c5391e3caf9231e0`, using `ATOMIC_CORE_LOCAL` and `ATOMIC_APP_CORE_LOCAL` together. A stock 0.19.1 download does not contain the submitted stream fix and is not a substitute for this pair.
- **Consequences:** The personal build needs integration tests against the actual patched pair, including native attachment and isolated desktop restart/download/chat checks. The core version check remains enabled. No model data, default settings, wire protocol or PR branch is changed by combining the fixes. Upstream updates and merged fixes must be reconciled deliberately before rebuilding this branch.
- **Owner:** @Young-uk.
- **Links:** [downloads](https://github.com/AtomicBot-ai/Atomic-Chat/pull/389), [message clocks](https://github.com/AtomicBot-ai/Atomic-Chat/pull/390), [image observers](https://github.com/AtomicBot-ai/Atomic-Chat/pull/391), [loopback streams](https://github.com/AtomicBot-ai/atomic-chat-core/pull/54).
