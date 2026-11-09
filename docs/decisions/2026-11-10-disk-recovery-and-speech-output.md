# Emergency disk recovery and speech output changes

Normal cached summaries wait on a structured memory admission refusal and retry with cancellation support. They keep the original conversation and display a memory-wait state. Urgent context recovery uses the cached summary adapter, not legacy segmented extraction.

Strata may enable serial disk recovery only for the explicitly pinned new native runtime. After a clean memory refusal, require a complete bound token receipt and an idle main continuation. Save the original main state to a private disk snapshot, seal the existing scheduler against other foreground turns, append summary instructions to the same main cache using ARECOVER, and restore the exact saved state before unsealing. Native admission verifies the exact main prefix and absolute-position headroom, including processed image contexts. No separate recurrent bank or 128-input limit is introduced. A failed or mismatched restore retains the snapshot, poisons admission, and blocks further inference. A clean failed SAVE leaves the original untouched. The existing RAM admission for SAVE/RESTORE still applies; inability to preserve/restore safely is a genuine blocker, not success.

Dstar already has its own dedicated clone slot and does not use Strata's state-bank memory gate. Both engines use cached context recovery and exact token admission; no unsupported disk protocol is sent to Dstar.

Speech output recovery reuses the mounted audio element and playback position after a paused output-route interruption. It makes at most two resume attempts, listens for device changes, preserves cancellation, and never regenerates or replays an already heard sentence.

Cached summaries use the shorter instruction with the same evidence, boundary, ledger and JSON limits. Summary request temperature, including the legacy adapter, is explicitly 1, by user choice after a greedy summary emitted a single token repeatedly. Foreground chat and completion review sampling are unchanged. This is not a demonstrated fix for cache corruption or repeat degeneration; real-model comparison is reserved for the user.
