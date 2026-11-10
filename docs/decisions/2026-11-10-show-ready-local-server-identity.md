---
date: 2026-11-10
title: "Show the ready local server identity"
---

# Show the ready local server identity

- **Problem:** the Server sidebar and overview displayed the configured API provider even when another managed engine was serving the conversation.
- **Decision:** prefer a ready, owned local runtime snapshot and its served model IDs. Use the matching target provider only when it belongs to that runtime. Label this identity as the running engine and link to endpoint controls. Keep the recorded API provider as a fallback when no verified local server is ready.
- **Scope:** presentation only. Do not change API routing, the selected provider, or start and stop any runtime while deriving the label.
- **Connections:** the loaded-model status, copied request examples and test request use this same ready runtime identity ahead of generic active models and the saved API default. This changes the explicit model ID in the example, not backend routing rules. Hide an earlier test result after the displayed model changes. For a ready managed engine, context length comes from the native active-context snapshot; unknown active context is omitted rather than replaced with potentially stale provider settings.
- **Validation:** regressions cover Strata running alongside a stale Dstar API selection, stopped/loading/error/external fallbacks, and endpoint navigation. Real Chromium layout checks cover Medium and Extra Large fonts, 1024/1280 px, narrow sidebars and light/dark themes.
