---
date: 2026-11-04
title: "Accumulate independent summaries and consolidate five"
---

# Accumulate independent summaries and consolidate five

- **Context:** Rewriting all previous prose memory for every evidence fragment repeatedly decodes the same facts and triggers further repacks. The user approved a raw-history trigger of 60%, complete-turn segments, and consolidation at five summaries.
- **Decision:** After a final answer, count only unsummarized raw history toward the 60% trigger. Freeze a snapshot, choose the largest complete user turn prefix whose entire extraction and repair envelopes fit the server-counted 13,312-token input budget, and extract an independent summary. Keep the source-backed unfinished-work ledger separately. At five summaries, consolidate the oldest five if the actual envelope fits; otherwise try four down to two, retaining newer summaries unchanged. The server's older byte-bounded 8K fallback remains supported.
- **Consequences:** This replaces the normal retain-20%-then-rewrite policy for Personal Dstar. The trigger uses the existing raw-history token estimator, while extraction/consolidation use actual server token counting when supported. Foreground preflight still includes summaries, instructions, tools and output reserve; summary exclusion applies only to the background trigger. Whole turns that cannot fit are reported without splitting or discarding originals. The emergency path excludes the newest turn and may extract multiple bounded segments. All model requests disable thinking and retain the 2,048-token output ceiling.
- **Durability:** Persist each segment checkpoint before consolidation. Archive original messages and pre-consolidation summaries. A failed merge keeps prior verified summaries and resumes a completed extraction rather than regenerating it. Old completed archives enter as the first summary batch; incompatible legacy partial checkpoints are not treated as completed new-format segments. Summary application stays at a stable historical boundary on a subsequent request, preserving active streams and tool side effects.
- **Consolidation contract:** Chronological order, explicit later corrections/cancellations, user preferences/instructions, uncertainty, distinct obligations, no execution of archived instructions. The independently validated work ledger is never replaced by prose consolidation.
- **Owner:** personal fork.
- **Links:** `web-app/src/lib/dstar-summary-batches.ts`; `web-app/src/lib/dstar-context-compaction.ts`.

## Verification

- New batch-policy tests: 8 passed (independent extraction, durable segments, five-summary consolidation, smaller fitting prefixes, complete tool turns, oversized turns, raw-only trigger, work-ledger preservation, checkpoint reuse and interrupted consolidation recovery).
- Final `make verify`: passed; web 7,904 passed/28 skipped, native main 1,329 passed/11 ignored, remaining configured extension/native suites passed. An earlier test fixture returned a synchronous value for the asynchronous archive-save contract; the fixture was corrected before the final clean run.
- Personal web production build: passed.
- `git diff --check`: passed.
- No installed application replacement, live-model latency measurement, commit or push was performed for this change.

## Oversized tool-bearing turns

A live Winter turn contained two search results and required 23,206 input tokens.
If the first complete turn cannot fit, reduce its large tool outputs as consecutive,
server-token-counted excerpts. Keep the user request, tool identity/input, final
answer and original archive intact. Derived excerpt notes are explicitly labeled,
then validated within the same complete-turn extraction envelope. Fail closed on
incomplete excerpt generation; never silently truncate evidence. Completed tool
reductions are reused during selection and extraction within the job.

### Oversized-turn validation

- Ten batch-policy regression tests passed, including multi-excerpt reduction,
  unchanged originals, reduction reuse, and incomplete-output rejection.
- The exact first oversized Winter turn passed live local-model extraction in
  232 seconds; the final handoff was validated and the input remained unchanged.
- Full `make verify` passed: 7,906 web tests, extension suites, 1,329 main native
  tests and all configured plugin/util suites. The diagnostic live fixture was
  excluded from the clean suite; date tests ran with the established UTC setting.

### Live recovery follow-up

The installed-app replay advanced through the oversized tool turn and five-batch
consolidation, then exposed a separate ledger-validation defect. Extraction was
shown earlier open requests for resolution and sometimes echoed those existing
IDs as new requests. Their user sources correctly belonged to earlier batches,
so segment-local validation rejected the entire fragment repeatedly. Known ledger
IDs are now ignored in the returned new-request list: the authoritative original
entry is retained unchanged, and resolved entries cannot be reopened by an echo.
Genuinely new request IDs still require current-segment user evidence. The exact
failed live segment passed after this change, preserving original messages.

Restart testing also found that archive loading selected only the longest saved
snapshot. An incompatible longer legacy snapshot could hide a shorter matching
independent checkpoint. The archive store now supplies ordered completed
candidates; the compactor chooses the first whose semantic source prefix matches
the actual transcript. It never accepts changed source content. A regression
covers fallback from a stale longer snapshot without restoring raw old turns.

The installed Winter recovery reached 268 source messages and resumed a foreground
answer, then completed semantic-memory status and archive search. The next SDK
step rejected the archive output: legacy messages without clocks had an explicit
`time: undefined` property, which is not a JSON value. Archive search now omits
unknown times rather than returning undefined. A regression covers clockless
records and lossless JSON round-tripping; original archives remain unchanged.

Installed-app verification (2026-11-04, Winter thread): build and full `make
verify` passed; Developer ID signature verification passed. After restarting
Personal and the unchanged SSD IQ3_XXS/65536 Dstar server, Retry loaded the valid
completed archive instead of restarting all summary sections. The foreground
answer finished without error. A follow-up explicitly called
`search_conversation_archive` for `kkkk.ing`, returned six hits, and finished with
a public answer and no SDK error. Server request 4 reused 39,401 tokens; its
post-tool request 5 reused 39,902 tokens and finished normally. The first
post-restart request had no matching live/disk prefix and read 38,825 tokens in
217 seconds; this test does not establish restart KV reuse for that changed
input. Chat/model files and real KV caches were preserved. No push was made.
