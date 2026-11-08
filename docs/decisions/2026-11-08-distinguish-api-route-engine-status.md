---
date: 2026-11-08
title: "Distinguish API routing from engine health"
---

# 2026-11-08 — Distinguish API routing from engine health

- **Context:** The Server overview presented a saved Dstar API choice as the engine, and advertised readiness based only on completed setup, while chat used Strata and Dstar was stopped. The API listener can remain up and advertise configured remote models whose backends are unavailable.
- **Decision:** Label the API listener and configured provider explicitly. Report the selected managed chat engine separately using its native-backed coordinator snapshot, requiring matching engine and served model before displaying readiness. Viewing this page must not start, stop, or switch an engine. Keep API routing and user security settings unchanged.
- **Consequences:** Dstar API configuration and a ready Strata chat engine can appear together without implying Dstar is running. Remote API requests still route by requested model ID; listener availability is not backend health. Unconfirmed or stale managed snapshots are not reported ready.
- **Owner:** team.
- **Links:** `web-app/src/containers/server/ServerEngineIdentity.tsx`, `web-app/src/containers/server/useServedModel.ts`, `src-tauri/src/core/server/proxy.rs`.
