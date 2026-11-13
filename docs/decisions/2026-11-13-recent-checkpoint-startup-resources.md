# Recent disk checkpoint and prepared Metal resources

## Decision

The personal Strata policy opts into a fourth disk checkpoint: the nearest compatible checkpoint before the deepest one, in addition to the existing oldest, middle and deepest recovery anchors. The native reader and file format are unchanged. Prefix equality, pinned boundaries, the existing memory admission check and disk budget still apply. At the current Qwen geometry an extra running state is about 113 MiB on disk; transient copy peaks are included before admission. Existing three-checkpoint archives do not acquire the missing state until a later inference creates and saves it.

Opt into allocation-only Metal resource preparation before READY. Reuse the expert arena and prompt-scratch preparation previously used for cold summary admission. Run no tokens, modify no conversation state and create no summary bank. The time moves into startup; this is not a reduction in total cold-start work. Limit this opt-in path to the already supported state-bank window configuration. Preserve MTP-off, 4096-row chunks, 128K context, arithmetic, scheduler, parallel configuration and existing memory budgeting.

## Validation and delivery

Use the saved 41.8K real conversation in isolated caches. Compare warmup off/on with identical greedy outputs and three/four saved anchors on the same edited request. Check exact native restoration, clone summary and unchanged production files. Run checkpoint memory/refusal/pinned-prefix regressions, Metal tests and personal app gates. Install only after successful live comparisons. Admit the exact preceding 128K original-IQ4 cache through a reviewed qualification bridge; retain native geometry and payload validation.
