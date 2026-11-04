# Native approval handoff and tokenizer-based background trigger

The Personal worker can return an immutable `approval_required` proposal after the
outer MCP approval. Returning that result to the model alone left execution
waiting for a model-authored `confirm` call. The chat executor now owns this
handoff: inspect through the existing approval adapter, display its authoritative
preview, await a fresh human decision, and confirm the same proposal. Denial,
expiry, cancellation and a disabled connector fail closed. Chained changed plans
require another fresh approval; repeated IDs and more than eight plans stop.

Independent summary batches retain their sixty-percent raw-dialogue policy and
post-answer scheduling. The running tokenizer now counts the unarchived dialogue
when supported instead of relying solely on the character heuristic. Historical
summaries and fixed instructions are excluded. Older servers keep their existing
fallback. The count is an encoding of model-visible dialogue, not a claim that it
is identical to the foreground chat template's exact occupancy.

Dstar additionally captures exact text-only recurrent state before the historical
summary or first image, whichever occurs first. A changed summary must not reuse
KV after the changed boundary, and image-conditioned payloads remain ineligible
for generic disk-text restore. Existing byte/token matching and disk budgets
remain enforced. Existing snapshots cannot be sliced backwards to invent this
checkpoint; the new checkpoint becomes available after a qualifying prefill.


Validation: `make verify` passed (7,919 web tests; 1,329 main native tests
and the remaining plugin/utility suites). The Personal release build and stable
Developer ID signature verification passed. An isolated real-model restart
probe changed the historical summary and introduced an image: 4,214 cached
tokens were restored, only 125 new input tokens were processed, and the image
answer completed correctly in 1.24 seconds. A first probe with a 512 MiB cache
evicted the checkpoint during normal shutdown; the repeated 1 GiB probe passed.
The production cache remains 4 GiB. Existing user-history end-to-end behavior
and the next sixty-percent boundary require separate observation.

Installed-app approval verification also passed in a separate QA conversation:
the stored-action dialog displayed `os.shell.run` and the exact printf command;
after approval, the original tool result contained `status: ok`, exit code 0,
and `ATOMIC_APPROVAL_OK`, and the model completed its final response. The
managed production endpoint returned Ready with IQ3_XXS and 65,536 context.


User-authorized extension: stored native action dialogs now offer Always allow
for an exact inspected action. The persistent key hashes the provider identity,
native tool, canonical arguments and guard request (including resources), never
pending IDs or expiry. Broad MCP/thread/Full access grants still cannot approve
other stored actions. Changed arguments, guard scope or provider need a new
decision. Existing Tool permissions settings can revoke the exact-action grant;
commands and credentials are not persisted in permission metadata.


Follow-up cache selection: a Chat Completions prompt-anchor hit now checks for
a strictly longer compatible disk text prefix before materializing the short
anchor. Existing model, quantization, context, text-hash and payload validation
remain authoritative. Live thinking/tool continuations are never displaced. A
failed disk load follows the existing safe prefill path; no recurrent state is
sliced or reused across removed history. This avoids treating a short memory
anchor as proof that no better durable checkpoint exists. Actual removal of
earlier dialogue still requires recomputing the affected suffix once.

Always-allow validation: make verify passed (7,923 web tests and all supported
native suites); focused approval/settings tests also passed. Installed-app
verification and real-model cache selection are recorded separately below.

Real-model follow-up validation (separate synthetic transcript, IQ3_XXS, 8K):
the short prompt anchor at 3,592 tokens was bypassed for the authenticated
4,214-token disk prefix after the handoff changed (33 tokens recomputed).
The appended follow-up reused 4,248 tokens (18 recomputed), and restart
restored 4,250 tokens (16 recomputed). Every response completed with READY.
The server frontend suite passed. Personal release build, installed executable
UUID and stable Developer ID signature were verified; the production server
was restored to SSD IQ3_XXS with 65,536 context. This bounded fixture does not
prove that every future edited/compacted real conversation avoids recomputation.

Installed Personal approval check: the native stored-action modal displayed
Allow Once and Always allow, exact shell arguments, scope limits, and the
settings revocation location. QA selected Allow Once, deliberately leaving
production persistent permissions unchanged. Persistent reuse/revocation and
changed-argument/provider isolation were verified by the focused tests.
