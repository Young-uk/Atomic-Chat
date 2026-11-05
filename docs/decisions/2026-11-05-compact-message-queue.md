---
date: 2026-11-05
title: "Bound the message queue and disclose editors on demand"
---

# 2026-11-05 — Bound the message queue and disclose editors on demand

- **Context:** Always-visible multiline editors and full-width action rows made two pending messages obscure a large part of the conversation, especially at enlarged interface scales.
- **Decision:** Show each pending message as a single-line preview with inline actions. Clicking its preview toggles one editor. Bound the whole queue to 10rem with internal scrolling. Preserve queue order, pause, attachments, edits and immediate dispatch semantics.
- **Consequences:** Long text is available through the preview tooltip and editor. Large queues scroll internally instead of growing over the conversation. Missing knowledge namespaces now produce actionable validation guidance rather than suggesting that profile storage is unsupported; writes never infer a namespace.
- **Owner:** personal fork.
- **Links:** `web-app/src/containers/MessageQueue.tsx`, `scripts/personal-agent-tools/notes.mjs`.
