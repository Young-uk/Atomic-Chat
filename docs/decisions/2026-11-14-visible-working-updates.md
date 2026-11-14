# Visible updates during local model work

## Context

The active Strata model emitted reasoning and tool calls without public text even
though the plain system policy recommended conversational updates. The policy
was also omitted when no tools were enabled. Real SDK streams already preserve
public text before a tool call; this is not a missing display channel.

## Decision

Make useful public updates an explicit part of multi-step work, with natural
opportunities before tools and after meaningful results. Keep private reasoning
private, preserve personality and permissions, and require the model to continue
working after a remark. Keep the policy present for advertised plain-system
runtimes and the existing opted-in Dstar endpoint even when tools are disabled.
Unknown runtimes receive no new policy. Do not rewrite historical tool preambles.

This is a model instruction, not a guaranteed interruption inside a single
reasoning block. The model must finish its current private thought before
emitting public text. No reasoning extraction, synthetic updates, extra model
calls, summary changes, or output limits are introduced.

## Validation

Compare old and proposed policies with the actual active persona and Strata IQ3,
using synthetic read-only tool results and thinking enabled/disabled. A small
initial test cap is not evidence of successful task completion; confirm the
final answer separately with sufficient room. Transport tests cover advertised
and unknown runtimes with tools both available and unavailable, including real
SDK public text followed by a tool call, with immutable stored history.

The system prefix changes once and may require a fresh prefill. Model weights,
server cache format, summary/review policy and native settings remain unchanged.
