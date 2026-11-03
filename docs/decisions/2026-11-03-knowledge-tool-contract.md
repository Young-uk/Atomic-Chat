---
date: 2026-11-03
title: "Make knowledge tool identifiers explicit"
---

# 2026-11-03 — Make knowledge tool identifiers explicit

- **Context:** Live self-tests exposed an advertised but unimplemented profile search and ambiguous lesson/procedure evidence identifiers. The model repeatedly tried source strings where numeric note IDs were required.
- **Decision:** Implement active-profile substring search over key/value/keywords; accept fact IDs for profile get/history, while destructive profile operations still require a key. Add sourceNoteId and parentLessonId with legacy id/targetId aliases for creation. Document area-specific requirements and the pinned-profile context included by notes recall.
- **Consequences:** Existing calls remain compatible. Search now returns a labeled profile-substring result and does not alter FTS note search, profile grounding, stored user data, or automatic recall policy. All evidence existence checks remain mandatory.
- **Owner:** @Young-uk.
- **Links:** `scripts/personal-agent-tools/notes.mjs`.
