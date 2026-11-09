# Full access native confirmations and custom tool updates

Status: accepted

## Problem

A custom tool update was sent as `register` with the definition encoded in `input`. The adapter read only top-level fields and rejected a missing name, even though the stored custom tool implementation already supported replacement. Chat also required a human for every nested native confirmation even when the user explicitly chose Full access.

## Decision

Accept either top-level definition fields or one JSON object in `input` for `register` and `update`. Reject conflicting fields and unknown nested keys. `register` creates or replaces; `update` requires an existing custom tool. Keep schema validation and revision-bound execution approvals.

Use the explicit conversation approval mode for native proposals as well as outer Personal tool calls. Full access automatically confirms an inspected, unexpired proposal. Restricted continues to require a fresh decision. The global MCP toggle alone never authorizes Personal tools. Existing bounded confirmation loops, provider availability checks, stale-proposal rejection and OS permission requirements remain in effect. Do not pass model-authored auto-approval flags to the worker.

## Validation

Model-free adapter tests cover nested registration, updating without duplicates, conflicting envelopes, missing tools and invalidating old code approvals. Chat tests cover Full access, Restricted and expired proposals. Actual model generation is left to the user.
