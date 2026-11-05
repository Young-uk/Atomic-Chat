---
date: 2026-11-05
title: "Preserve independent prefix state across summary adoption"
---

# Preserve independent prefix state across summary adoption

Production reused over 61K tokens before adopting a summary, then reused zero
of a 46,759-token request despite an unchanged 10,811-token prefix. The server
advanced to the durable dialogue boundary before saving the independent
in-memory prompt anchor. A warm restored checkpoint could also bypass the
cold-only fixed-prefix capture path. Console-only summary scheduling evidence
was unavailable in the persisted application log.

Capture the fixed recurrent state before advancing to the durable boundary,
including partially restored prefixes and an exact fixed-boundary restore.
Protect its verified disk checkpoint while saving a larger dialogue checkpoint;
retain the existing disk budget and decline the larger write if both cannot fit.
Never truncate a warm recurrent payload backwards to manufacture a checkpoint.
A legacy warm session without an independent anchor therefore needs one safe
rebuild before it can benefit. Model computation, summary placement, sixty-percent
raw and eighty-five-percent envelope triggers remain unchanged.

Persist numeric scheduling evidence in the existing archive record: trigger
reason, context, raw/tokenizer count, envelope estimate, thresholds and time.
No additional chat text or configuration file is introduced. Existing archives
without this optional diagnostic remain readable.

Verification: `make verify` passed (7,925 web tests, extension suites, 1,329
main native tests and all supported plugins/utilities). Dstar frontend tests
passed including partial/equal/warm boundary eligibility and protection under
a full disk budget. A real IQ3_XXS/8K fixture with a 512MiB isolated disk budget
reused 3,592 tokens across a changed historical segment in memory, then reused
3,592 tokens across a different segment after restart. Subsequent requests
reused 4,249 tokens; a further restart restored 4,251. All answers completed.
These are isolated real-model results, not proof of every Winter transcript
or image-conditioned restart. The production model files were read only.

Installed-app verification: the signed Personal app and tested server were
replaced, then restored with the original SSD IQ3_XXS model and 65,536 context.
A separate existing QA conversation completed two arithmetic answers (5 and 7).
The latter reused 16,547 tokens and prefetched only 388 new tokens. Another QA
request and its retry ended with reasoning but no answer; the server logged
normal stop before the output limit, and the bounded continuation also ended
empty. This generation failure is not resolved by the cache change and remains
a separate observed limitation. No test messages were added to Winter.
Winter was reopened after QA; its full post-summary lifecycle was not exercised.
Completed debug test artifacts and coverage were removed within the approved
scope. No commit or push was performed.
