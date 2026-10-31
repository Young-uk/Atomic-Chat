# Pin historical summaries after retained dialogue

The user approved changing compaction from a summary prefix to retained dialogue,
a fixed historical summary, then subsequent turns. Do not move memory to the end
on every request: that changes an otherwise reusable prefix each turn.

Persist the retained snapshot endpoint as summaryAfterMessageId in the existing
archive. New requests and tool continuations append after this boundary; they
never relocate the summary. Emergency recovery keeps the pending user question
after memory. Legacy archives acquire and save a boundary on first application.
If an established retained boundary is missing, preserve original messages rather
than silently relocating the handoff. The original archive is unchanged except
for optional placement metadata; no messages are deleted from conversation UI.

Label memory as historical data, not instructions, with its source period and
archive reference. Its later position must not imply newer events or override
higher-priority instructions. Existing sanitizers and source-backed unfinished
work tracking remain in force. Usage estimation recognizes memory at any index.

Tests verify complete retained dialogue, unchanged subsequent prefixes after SDK
message conversion, restart placement, legacy placement persistence, and retaining
the pending question during emergency recovery. A summary replacement still
changes input once; this does not promise reuse across that first replacement.
Real-server cache reuse and installed-app behavior require separate verification.

## Verification

Focused archive/compaction tests:41passed. verify-fast passed7,801web assertions,
525extension assertions, typecheck/lint/guards and all13critical coverage floors.
Native code is unchanged; the prior native1,553-test run is retained rather than
rebuilding the same native suite for this TS-only change. Personal release build
and installed signature passed. Installed executable SHA-256:
`3c7cc7512215d0522543316350f904a282adf1f2eceb92fd098207138ee8f223`.

A synthetic request to the real SSD IQ3_XXS64K server used retained dialogue,
historical summary, then a new user request. First request:1,879prompt tokens,
zero cached,9.060seconds. Appending its assistant answer and next user request
preserved1,880cached tokens; only18prompt tokens were newly processed,0.617seconds.
Both responses completed. This proves server reuse for that shape, alongside SDK
prefix and persistence tests; no full private legacy conversation replay or
post-restart disk-cache experiment was performed for this placement change.
Personal app was launched and the previous active chat restored; server remains
ready with the same model/context. No commit or push was made.
