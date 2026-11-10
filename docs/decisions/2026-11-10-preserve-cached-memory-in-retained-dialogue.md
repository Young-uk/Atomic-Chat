---
date: 2026-11-10
title: "Preserve cached memory inside retained dialogue"
---

# Preserve cached memory inside retained dialogue

- **Context:** after a successful cached summary, the next request reused 23,812 of 36,649 tokens but reread 12,837. New summary prose measured about 3,590 tokens. The previous archive's insertion anchor was inside the newly retained dialogue. Replacing that historical message broke the contiguous native history match before later, unchanged turns.
- **Decision:** preserve the exact prior historical messages whose anchors remain in the retained tail. Persist their placements with the replacement archive and send the identical projection during boundary planning and generation. Append the new summary at its existing fixed boundary. Remove inherited memory automatically when its anchor falls into an archived prefix. Original dialogue and summary evidence stay unchanged.
- **Consequences:** a small amount of already-cached historical memory remains until its surrounding turn is archived. This preserves the whole retained suffix without a native layout change or a new output cap. Existing adopted archives are not retroactively rewritten. Both managed engines share the application projection; no model or native cache format changes. Validate replacement, restart, expiry, planning parity and a read-only local transcript replay without model inference.
- **Owner:** personal fork.
