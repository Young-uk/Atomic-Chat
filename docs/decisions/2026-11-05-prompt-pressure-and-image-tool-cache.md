---
date: 2026-11-05
title: "Account for prompt pressure and retain image tool frontiers"
---

# 2026-11-05 — Account for prompt pressure and retain image tool frontiers

- **Context:** raw dialogue can remain below sixty percent while fixed system
  instructions, tools and historical memory exhaust the foreground window.
  The post-answer cost callback also omitted system instructions. Separately,
  Dstar rejected every Qwen tool-turn visible checkpoint with historical images,
  even though its live checkpoint machinery authenticates image fingerprints
  and marker offsets. A real tool-result continuation consequently fell back
  from a 54K live state to a 25K durable prefix.
- **Decision:** retain the sixty-percent raw-dialogue trigger and add an
  independent eighty-five-percent full-envelope pressure trigger after answers.
  Include system instructions and the foreground output reserve in that cost.
  Re-evaluate pressure after each durable batch, without including summaries in
  the raw-dialogue count. Dstar permits image-bearing tool-turn visible
  checkpoints through the existing image-prefix validation. Numeric scheduling,
  completion, failure and tokenizer diagnostics explain future decisions.
- **Consequences:** overhead-heavy conversations can summarize before overflow;
  this may start background work earlier than the raw-only policy. Batch size,
  five-batch consolidation, foreground priority and source preservation remain
  as configured. Changed/removed historical input still invalidates state after
  the first mismatch. Generic disk checkpoints remain text-only because their
  format does not authenticate image state; this change does not claim durable
  restoration of image-conditioned KV after a restart.
- **Owner:** @Young-uk.
- **Validation:** focused batch/transport tests passed (84 tests), as did the
  Dstar server frontend suite. Full verification and runtime checks are tracked
  separately; these focused results do not prove installed-app behavior.

An isolated IQ3_XXS/8K real-model image/tool round trip completed: the tool
result reused 2,430 tokens and processed 36 new tokens in 0.58 seconds. After
normal server shutdown and restart, the safe pre-image text checkpoint restored
2,314 tokens and processed the remaining 152 in 1.65 seconds. Both final answers
completed. This fixture verifies live image/tool continuation and text-prefix
restart restoration, not durable image-conditioned KV restoration or the full
production Winter transcript.

Full `make verify` passed with Node 24 and UTC (7,925 web tests, 1,329 main
native tests and all supported extension/plugin/utility suites). Initial runs
exposed a Node ABI mismatch, a mixed-version Yarn launcher and two existing
date tests that assume UTC; verification used a consistent runtime/timezone
without changing those unrelated tests. Completed debug artifacts were removed
under the user's explicit cleanup authorization before the Personal build.

The Personal build completed and was installed with the existing Developer ID
(Team ZCBVA844NX), UUID CF8799A4-E826-3095-BD0F-7D3886700972. Installed-app QA
completed its answers: an ordinary follow-up reused 14,481 tokens; after normal
app/server shutdown and restart, the first QA request restored 14,893 tokens
from disk, processed 384 new tokens, and completed in 4.29 seconds. Server
token-count diagnostics were observed after that answer. Production was
restored to SSD IQ3_XXS with 65,536 context and the original Winter screen.
No test message was injected into Winter. Its next real threshold crossing
and image-bearing restart remain separate observations, not claimed passes.
