---
date: 2026-11-08
title: "Configure Strata context through the managed owner"
---

# 2026-11-08 — Configure Strata context through the managed owner

- **Context:** The Personal Strata endpoint exposed start/stop controls but always launched with a 65,536-token main context. Dstar already allowed a configured context. Strata's separate experimental summary state remains 16,384 tokens; its runtime identity includes the main launch context.
- **Decision:** Expose an integer main-context setting of 16,384 through 65,536 tokens, defaulting to the existing 65,536. Persist it independently of Dstar. Display saved, pending and actually running values separately. Apply a changed running value only through the existing managed-owner idle/drain/stop/restart lifecycle. Preserve strict runtime identity checks and derive a context-specific model/config pin only after the original pinned configuration matches.
- **Consequences:** The current foreground capacity is not expanded beyond the existing experimental envelope; this is a conservative product limit, not a claim of empirical qualification. Main-context changes take effect on restart and change runtime/config identity, invalidating stale usage and summary observations. Summary thresholds continue to use the actual server-reported main context at 60% and 85%; the summary state itself remains 16K. Existing Dstar configuration, chat records and external runtimes are unchanged. Real-model conversation and stability testing remain with the user.
- **Owner:** team.
- **Links:** `web-app/src/containers/server/StrataControlPanel.tsx`, `web-app/src/services/managed-local-engine.ts`, `src-tauri/src/core/managed_engines.rs`, `src-tauri/src/core/dstar.rs`, [Actual-context summary scheduling](2026-11-08-schedule-summaries-against-actual-context.md).
