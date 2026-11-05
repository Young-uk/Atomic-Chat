---
date: 2026-11-06
title: "Reserve output space before Dstar foreground inference"
---

# 2026-11-06 — Reserve output space before Dstar foreground inference

- **Context:** A rendered foreground prompt consumed 65,457 of 65,536 tokens. The remaining 79 tokens were exhausted in reasoning without an answer. The client's heuristic fit check had underestimated the server prompt.
- **Decision:** Personal Dstar requests opt into an exact server-side output reserve, capped at 2,048 tokens and the requested output limit. A pre-inference context rejection enters the existing one-shot summary recovery with the measured undercount included in projected budgets. Summary requests and other clients retain their existing boundary.
- **Consequences:** Recovery happens before new output or tool execution. Previously streamed content and completed tool results stay in the same logical continuation. The reserve reduces available prompt space; it does not guarantee an answer if generation itself exhausts the output limit. No partially emitted stream is automatically replayed.
- **Owner:** @Young-uk.
- **Links:** `web-app/src/lib/custom-chat-transport.ts`; companion Personal Dstar `ds4_server.c`.
