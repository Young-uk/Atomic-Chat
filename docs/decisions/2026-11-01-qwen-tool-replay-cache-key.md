---
date: 2026-11-01
title: "Key Qwen tool frontiers by rendered client history"
---

# 2026-11-01 — Key Qwen tool frontiers by rendered client history

- **Context:** Installed Personal Chat QA reused 17,292 tokens through a visible thinking continuation, then lost all reuse after its tool call. The next request had 17,537 tokens and took 119.226 seconds to prefill. A historical whitespace/token difference was retained in sampled KV, but the tool checkpoint assumed echoed reasoning implied exact sampled-text replay.
- **Decision:** In the personal Dstar source (`ds4_server.c`), construct the tool frontier with the same Qwen assistant renderer used by client history, including echoed reasoning and raw-tool separator rules. Preserve the request's historical bytes. Use this rendered visible key for disk eviction too, instead of sampled token text. Keep the missing assistant end boundary in the new suffix.
- **Consequences:** Exact visible-prefix and image checks remain mandatory; edited histories do not gain a fuzzy cache match. Inference guidance, output limits and tool permissions are unchanged. Server-only deployment; the installed Chat frontend is unchanged.
- **Validation:** Server regression suite and binary build pass. Tests cover thinking on/off, empty/nonempty content, echoed reasoning whitespace, edited-prefix rejection and incomplete-tool rejection. Live reasoning-enabled tool-result requests reused 1,594 tokens and processed 20 new tokens, including after disk eviction. Installed Chat repeated tool-result QA reused 18,578 tokens and processed 124 new tokens, returning CACHE_FOLLOWUP_OK.
- **Owner:** personal fork.
- **Links:** personal Dstar fork `Young-uk/ds4`, branch `experiment/append-effort-oct30`; diagnostic request IDs 23–25 on 2026-11-01.
