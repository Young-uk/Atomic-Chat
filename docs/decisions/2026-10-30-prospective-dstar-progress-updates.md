# Prospective, model-authored progress updates

Status: deployed locally and live-tested; not pushed.

## Decision

New opt-in Dstar user turns record `atomic_dstar_tool_preamble_v1` together
with their tool catalog. Replay inserts the trusted `atomic-tool-preamble:v1`
event after a changed catalog, or at the first newly marked turn. The server
renders its immutable English policy at that position rather than hoisting it
into the initial system prompt. Existing turns and tool catalogs are untouched.

The policy asks the model to communicate meaningful interim understanding at
points where outside information or action becomes useful, drawing on its
current assessment and uncertainty. Wording, timing and detail are left to the
model. There is no fixed phrase, sentence count or mandatory announcement for
every tool call. Updates must be actual assistant content outside the private
reasoning channel; no app-generated dialogue or hidden-reasoning disclosure is
introduced. Unverified work must not be reported as successful, and execution
approval requirements remain intact.

## Validation and limits

Check persisted metadata, SDK/thread identity, immutable legacy prefixes,
replay after reload, unchanged catalogs, trusted role gating, and natural text
before structured tool calls. Instructions influence model behavior rather
than guarantee a progress utterance on every turn. Live tests must cover both
tool-needed and direct-answer cases and inspect the order of streamed text and
tool calls. No sampling settings, tool execution rules or result handling change.

## Local verification

Web/core: 7,726 passed, 19 skipped; extensions: 525 passed; 13 critical coverage
floors passed. Type checks, focused persistence/transport tests, Dstar frontend
regressions and the native Personal app build passed.

A contextual synthetic project-check task produced visible assessment text
before the first tool event. Its tool-result continuation reused 848 tokens.
A direct arithmetic question answered without a tool or a waiting announcement.
Simple lookup probes sometimes omitted a visible update: this is model-authored
behavior, not a guarantee or app-enforced narration on every call. Early
candidate policies were tested before any app turn recorded the marker; the
final policy clarifies that the catalog's function-only format limits the XML
block rather than preceding user-facing prose. Future text changes require a
new marker version now that app turns have recorded v1.

In the installed app, an IANA-source QA request persisted the policy metadata
and stored reasoning, text, tool_call, reasoning, text in that order. The
visible text preceded the actual lookup; final text followed results. The
continuation reused 4,447 tokens and processed 2,277 new tokens. No real-user
conversation was submitted as a test, and no fixed dialogue was injected.
