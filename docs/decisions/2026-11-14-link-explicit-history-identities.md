---
date: 2026-11-14
title: "Link explicit history identities and explain empty results"
---

# 2026-11-14 — Link explicit history identities and explain empty results

- **Context:** Older Winter chats use different assistant IDs despite sharing the display name. Same-ID retrieval excluded them, and the model incorrectly inferred a recent-only retention policy and saved that speculation.
- **Decision:** Allow explicit, disjoint assistant-ID groups in the existing Personal feature settings. Groups are host configuration, never model search arguments or automatic name matching. Existing installations default to exact-ID scope. A group expands search and neighboring-context access only inside the same project. Removing the group immediately restores exact-ID restrictions.
- **Diagnostics:** Search reports the effective identities, project, accessible date bounds and counts, requested-day message count, and an explicitly scoped empty reason. No age cutoff is imposed. Out-of-scope titles or dialogue are not disclosed. Empty results cannot establish absence, deletion or retention policy.
- **Conversation policy:** Ordinary social reactions do not trigger unsolicited diagnostics or memory/skill maintenance. Durable technical claims need observed evidence; guesses stay explicitly uncertain.
- **Migration:** Explicitly link the user's confirmed old/current Winter identities in local settings. Correct the identified speculative note in place with a local rollback copy, preserving ID, provenance and unrelated memories. Do not rewrite historical conversation messages or infer that a referenced purchase occurred.
- **Validation:** Source tests cover opt-in cross-ID search and context, project boundaries, revocation, duplicate/overlapping groups, scope diagnostics and settings preservation. Existing history tests and the full app checks remain required.
