---
date: 2026-11-07
title: "Keep Personal audio engine updates out of the chat banner"
---

# 2026-11-07 — Keep Personal audio engine updates out of the chat banner

- **Context:** Personal uses a locally patched audio.cpp engine. The shared chat banner offered `audio.cpp v0.9.3-abf1872f`, encouraging a replacement with the published build. The user requested removal of that prompt.
- **Decision:** Skip only `audio-cpp` during shared banner offer selection when `VITE_PERSONAL_BUILD` is `true`. Do not special-case a release tag or alter the core's version report.
- **Consequences:** Navigation and newer audio releases do not restore the unsolicited prompt in Personal. Manual audio engine updates remain in Settings; standard builds, other engine banners, and application release notices are unchanged.
- **Owner:** team.
- **Links:** `web-app/src/hooks/useEngineUpdate.ts`; `web-app/src/hooks/__tests__/useEngineUpdate.test.ts`.
