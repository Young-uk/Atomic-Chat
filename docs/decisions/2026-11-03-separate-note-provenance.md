---
date: 2026-11-03
title: "Separate note references from chat sessions"
---

# 2026-11-03 — Separate note references from chat sessions

- **Context:** Personal notes accepted a verifiable `source` string but stored it in the upstream session field. The upstream `source` output classifies the author, which made the public contract ambiguous.
- **Decision:** Add `sourceReference` with the existing `source` input retained as an alias. Store references in a Chat-owned SQLite companion table and actual sessions in the upstream session field. Public entries expose `author`, `sourceReference`, and `sessionId`. Legacy rows interpret their session field as the historical reference without rewriting it. Insert and forget update both tables transactionally.
- **Consequences:** Existing stored rows remain readable and author classification remains backward compatible. Token-prefix OR search remains unchanged and is documented in the tool descriptor. No model or conversation files are migrated.
- **Owner:** @Young-uk.
- **Links:** `scripts/personal-agent-tools/notes.mjs`.
