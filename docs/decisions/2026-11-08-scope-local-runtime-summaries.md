---
date: 2026-11-08
title: "Gate local summaries and tool policy by runtime capabilities"
---

# 2026-11-08 — Gate local summaries and tool policy by runtime capabilities

- **Context:** Dstar-only transport policy was tied to endpoint/model heuristics, while derived archives were keyed only by thread. Adding Strata must not send Dstar marker protocols to an incompatible engine or reuse summaries across runtime/model changes.
- **Decision:** Probe explicit capabilities on the selected registered local runtime. Enable summary inference only when its isolated slot is advertised; an exact token counter alone is insufficient. Scope derived archive adoption by provider, endpoint, model and a stable advertised model-file fingerprint; require a stable fingerprint for qualified Strata summaries. In-memory coordinators and current occupancy remain runtime-epoch scoped. Historical request usage uses the stable configuration scope and survives same-configuration restarts. Keep archive originals under their real thread for search. Strata's advertised plain-system tool policy asks for visible preambles and actual tool-result continuation, without synthetic thinking tags or fabricated tool calls.
- **Consequences:** Original messages and archive evidence remain intact. Legacy unscoped archives remain searchable but are not adopted into scoped coordinators. Switching provider/model cancels pending summary work, without holding a managed foreground lease. Dstar's immutable effort/catalog marker protocol remains Dstar-only. Summary and completion-review support fail closed when discovery is absent or incompatible. Actual backend isolation and live runtime validation are separate deployment gates.
- **Owner:** team.
- **Links:** `web-app/src/lib/custom-chat-transport.ts`, `web-app/src/lib/dstar-context-archive.ts`, `web-app/src/services/local-model-capabilities.ts`, `web-app/src/lib/atomic-tool-policy.ts`.

## Measurement semantics

Strata context metadata uses the successful final request step, not summed tool-step billing. Cache hit averages are arithmetic means of measured request ratios: zero is valid, missing or malformed measurements are excluded. Current occupancy and progress are hidden after a runtime restart. Historical last-request usage and cache ratios remain available across same-configuration restarts, but are hidden if discovery cannot verify the identity. Context capacity comes only from the matching live `/models` row, never an assumed model maximum.

Dstar stable identity is verified against the matching API model and an owned, ready native selection with matching context. Its quantization/context key separates known IQ3 records from earlier quants. Contradictory native/API observations fail closed; unavailable native identity retains explicitly legacy-scoped behavior, never mixing legacy records into verified IQ3 measurements.

## Independent tool completion review

`atomic_completion_review: true` independently advertises support for the bounded review request protocol, even when general conversation summaries are unavailable. Neither the summary slot flag nor the background-compaction preference gates this separately advertised feature. A plain-system preamble alone, an exact token counter, or a summary slot alone never enables review. A `needs_tool` result requests one model continuation with the existing tool allowlist and permissions; it does not fabricate or execute a tool itself. Saved review boundaries replay on review-capable runtimes even without compaction. Servers must keep the capability false until their independent review execution path is qualified.

## IQ3 runtime and safe transitions

The fixed Strata registry now identifies ISTA IQ3_XXS. Dstar's existing `iq3`
selection and all other quant choices remain intact. The two engines use the
same installed SSD main and PLE files, with a separate Strata dense/tokenizer
pack. The earlier IQ2 registration and historical message metadata are not
rewritten automatically at app startup. Model/profile migration is a separate,
verified installation step and preserves the IQ2 backup.

Strata summaries use one serialized engine transaction, not a second model or
a concurrently scheduled physical KV slot. Native BEGIN saves live state and
protects the entire checkpoint chain and parked-conversation cache. END restores
live state, image embedding ownership and M-RoPE positions before returning the
protected caches. The 16K summary input/output budget is independent of the
foreground context limit. Uncertain BEGIN or failed restoration poisons the
lane and refuses further inference instead of continuing from an unknown state.
The runtime capability stays off until the exact candidate passes live text,
image, cancellation and cache-restoration qualification.

Switching away from Strata is two-phase. A private owner-authenticated quiesce
request refuses existing foreground work, closes inference admission, cancels
summary work and waits for rollback and HTTP cleanup. It does not stop the
engine. The frontend rechecks the latest selection before asking native code to
stop or start anything. Superseded selections and cancellation release the
admission drain. Native stop still checks listener ownership, zero reservations,
completed rollback and the drain state. Credentials and executable paths never
cross the renderer boundary.

The stable backend fingerprint is a file/configuration change detector, not a
cryptographic integrity proof. Deployment separately records full artifact and
model hashes. The process epoch is used only for live observations and in-memory
coordinators. This avoids treating previous-process occupancy as current while
preserving accurate historical request measurements.

IQ3 and snapshot restoration can use substantial unified memory on a 64 GiB
Mac. No OS memory/security limits are raised. Context capacity advertised by the
server is a configured limit, not proof that a full-capacity request is safe.
Runtime qualification must record peak pressure and swap, and must not force a
long-context test when headroom is insufficient. A rejected or cancelled summary
never authorizes deleting source messages or adopting a partial derived result.

## Qualified main-state envelope and early scheduling

Strata protocol 3 and an explicit `atomic_summary_cold_start: true` advertise qualified pristine EMPTY restoration, distinct from invalid or incomplete main state. Protocol 2 is not eligible. The contract requires an exact three-key qualified envelope: positive integer `max_main_tokens`, `max_snapshot_bytes`, and `max_protected_bytes`. Main tokens cannot exceed INT32_MAX or the actual configured context; byte bounds cannot exceed JavaScript's maximum safe integer. The advertised fixed 1 GiB scratch reserve describes the protocol, not a client estimate of available RAM. The stable model fingerprint includes qualification flags, all three bounds and the backend transaction contract.

For qualified Strata only, background planning uses the smaller of actual context and the qualified main-token bound. Existing 60% raw-history and 85% prompt-pressure triggers therefore run earlier without lowering the user's configured foreground limit. These percentages are scheduling heuristics, not proof of safety: one long response, tool result, image or another thread may still exceed the envelope. The server measures actual main prompt plus generated tokens, snapshot/protected-state bytes and dynamic memory at every BEGIN and retains final refusal authority. Foreground overflow recovery still uses actual context, not the planning budget.

A structured admission refusal prevents another automatic attempt in that runtime. The latch rearms only after a successful foreground response reports a strictly smaller live token count at or below half the qualified main bound, or a new runtime is observed. When the initial refusal had no measured count, one new successful foreground completion at or below half the bound permits a retry. A second refusal captures that measured count and requires a strictly smaller later completion. Missing counts and duplicate completion IDs cannot rearm it; unchanged small counts cannot create repeated retries. Rearming is an opportunity to ask the server again, not a claim that byte or RAM constraints are now satisfied. Refusals retain raw archive copies and existing verified summaries, but never adopt an unsuccessful summary or checkpoint. No source text is deleted or truncated. The same safety envelope validation applies to independently advertised completion review, without coupling its enable flag to the generic summary-slot flag. Dstar behavior is unchanged.
