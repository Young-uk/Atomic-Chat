---
date: 2026-11-09
title: "Preserve Strata cache across reasoning effort changes"
---

# 2026-11-09 — Preserve Strata cache across reasoning effort changes

- **Context:** The managed Strata profile used start-position effort. Changing Low to Max rewrote the first system instructions and invalidated the conversation prefix, including a restored disk session. The backend already supports end-position effort and a checkpoint before its trailing system turn.
- **Decision:** Set `effort_position` to `end` for the Personal Strata profile. Resolve `--tail-role-token` through the configured tokenizer in the read-only prelaunch pin calculation, exactly as startup does. Bind the resolved argument and final configuration to the existing qualification checks. Keep unsupported tokenizers or engines rejected before launch.
- **Consequences:** Non-default effort instructions now follow the stable conversation instead of replacing its opening system instructions. This changes prompt composition, not model weights, sampling values, summary admission, or memory limits. Old qualification/cache identities are preserved for rollback and are not silently relabeled; the first launch of the new profile can start cold. CPU-only rendering and spawn-binding checks verify prefix stability without claiming inference-quality validation.
- **Owner:** team.
- **Links:** `src-tauri/src/core/managed_engines.rs`; Strata `serve/server.py::render_prompt`, `effort_end_args`, and `prepare_summary_qualification_pins`.
