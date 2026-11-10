---
date: 2026-11-10
title: "Preserve personal runtime behavior while importing window and profile fixes"
---

# 2026-11-10 — Import window and profile fixes

- **Context:** a full upstream merge conflicts in 133 files and moves the core from 0.20.7 to 0.22.1. Personal summary, cache, speech and desktop-control behavior must remain reviewable during integration.
- **Decision:** import upstream `f85766831` (a thread window retains its model and provider) and `48019d009` (isolated profiles also isolate webview storage). Restore the explicit thread-window selection before installing the personal local-engine coordinator. Keep personal engine installation inside the moved setup closure. The audio metadata-ready behavior from `9e0bfa69d` already exists and is not reapplied.
- **Consequences:** the core remains at its verified version for this stage. This is a selective update, not a claim of full upstream synchronization. Normal profiles retain existing storage. Existing summaries, tools, speech and managed endpoints remain in place. Validate with the full application verification gate; model inference remains reserved for the user.
- **Owner:** personal fork.

Strata is staged at upstream `504b14334` with the personal summary extension retained. Its geometry-based allocation keeps the larger summary scratch capacity. The application pins the new native/runtime identity and does not invent an old-session compatibility bridge. Existing conversation text remains durable; the first request after native replacement may rebuild its cache. Native disk fixtures and offline GUI-context qualification are checked independently of model inference.
