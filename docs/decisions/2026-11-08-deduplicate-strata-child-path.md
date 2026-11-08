---
date: 2026-11-08
title: "Deduplicate only the Strata child PATH"
---

# 2026-11-08 — Deduplicate only the Strata child PATH

- **Context:** macOS GUI PATH repair appended an identical trailing directory after the app started. Capturing its original startup environment missed this mutation. The actual Strata child therefore correctly failed its exact runtime fingerprint despite matching native and backend bindings.
- **Decision:** For the Atomic-managed Strata child on Unix, remove only exact duplicate PATH entries, preserving their first occurrence and order. Preserve empty entries and non-UTF8 bytes. Do not canonicalize paths, change the parent environment, hardcode a PATH, change pins, or relax fingerprint comparison.
- **Consequences:** Duplicate-only drift returns to the already-qualified lookup order. New unique directories and all other environment changes remain visible to the fail-closed gate. Dstar and non-Unix launch behavior remain unchanged. Installed-launch acceptance must verify the actual child fingerprint and optional-summary readiness before release.
- **Owner:** team.
- **Links:** [Launch policy](../../src-tauri/src/core/managed_engines.rs), [pure helper and tests](../../src-tauri/src/core/atomic_child_path.rs), [qualification binding](2026-11-08-bind-summary-qualification-to-runtime.md).
