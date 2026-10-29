# Append-only Dstar reasoning effort experiment

Status: experimental, opt-in; deployed locally for user testing; not pushed.

## Problem

The Qwen server prepends request-level effort instructions to the first system
turn. Changing that setting invalidates the earliest KV prefix and can force
an entire long conversation through prefill again.

## Decision

Enable only with `VITE_DSTAR_APPEND_EFFORT=true`, the managed local Dstar endpoint
and a Qwen3.8 model. Persist the validated effort snapshot under
`atomic_dstar_effort_v1` on each new user message. Keep visible content and
stored message ordering unchanged. The model-bound copy inserts versioned
system messages immediately before the user turns at which the effort changes.
Ordinary transcript rendering/copying has no synthetic message to display.
Structured backups may retain metadata, as they do other replay settings.

A paired experimental Dstar server recognizes exact system/developer markers
`atomic-effort:v1:<level>`, renders their instructions in place, and suppresses
the old effort-dependent system prefix. User text cannot trigger the protocol.
Unmarked requests retain the upstream rendering. The latest recorded marker
sets reasoning mode; request-level effort cannot rewrite earlier snapshots.
No KV compatibility check is bypassed and no cached tensor is relabeled.

## Consequences

The first transition from an existing unmarked conversation can require one
full prefill. Later changes preserve preceding rendered history, but ordinary
prefix changes (tools, images, compaction, edits, assistant instructions) can
still invalidate caches. New effort applies prospectively; it does not
reinterpret earlier turns. Regenerating or editing a recorded turn replays its
stored effort, rather than silently replacing its historical configuration.
Old application/server builds ignore or mishandle the markers, so both sides
must be validated and deployed together. Other models/providers are excluded.

Unlike the original medium setting, which supplies no extra instruction, a
mid-conversation medium event explicitly requests balanced reasoning to
supersede an earlier low/high instruction. This is a deliberate behavioral
change. Instruction adherence and response quality require live model checks;
string-prefix tests alone do not establish those results.

## Validation

Check UI-message persistence/replay, SDK conversion, unchanged visible input,
provider gating, user-text spoofing, legacy rendering, full prefix preservation
across Low/Max/Off, and existing server regressions. Before deployment, compare
actual cached/uncached token counts and reasoning behavior on an isolated
conversation. Do not interrupt the user's running server or modify model files.

## English instruction refinement and local deployment

Low retains essential fact and calculation checks. High validates key assumptions
and relevant alternatives, stopping when supported. Max additionally requests
counterexamples, edge cases, failure modes, and independent verification where
feasible, while avoiding redundant checks. All instructions are English.
The paired Personal app and Dstar executable were deployed locally and the server
reached Ready. Server regressions passed after this refinement. Earlier isolated
cache measurements used the previous wording; revised instruction quality has
not been benchmarked. No push or PR was made.
