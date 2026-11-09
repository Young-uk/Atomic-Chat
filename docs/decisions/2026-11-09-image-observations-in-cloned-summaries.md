# Summarize processed image observations through the conversation clone

Image-bearing conversation history must use the same one-shot cached summary path on managed Dstar and Strata. Remove the frontend file-part exclusion from both after-turn scheduling and restored-cache admission. The summary request remains text-only and sends the task, source anchors and request ledger, never image bytes or historical prompts. Ask it to preserve confirmed visual observations as text.

Dstar records completed image-conditioned main state as a clone owner. Its Metal copy already carries recurrent state, attention tensors, image positions and the MRoPE delta. Permit this source state while keeping image-bearing summary requests prohibited; image identities are not shared with the destination. Authenticated disk receipts can address a vision-tagged payload because the receipt still binds the exact file identity, semantic history and token frontier.

Strata records completed GENI requests and admits them to a bound native fork. Preserve the copied non-identity position map and absolute next position for text AFORK; keep raw image identities and embedding pointers in the main bank. The active main is restored by the existing bank exchange, including newer foreground turns.

On summary adoption, images belonging to the summarized source are omitted from future model input, including cached overlap retained for alignment. Cover direct image files, derived tool-image messages, image arrays and MCP content wrappers. Keep the confirmed text and unsummarized recent images; do not mutate the visible original chat. Original files are not deleted by this change.

When all image spans lie outside the retained native rows, allow text history compaction to forget their identities and move the remaining cache rows with their original positions. Refuse partial or retained-image relabeling. This is the existing approximate history-cache algorithm, now admitting fully removed image spans; it is not an exact replay claim. Other unsupported shapes retain the existing safe reread path.

Installation remains deferred. Validate frontend request/projection contracts, completed-GENI ownership, clone isolation and rejection cases, image-span guards, byte movement, native builds and standard app checks without running model inference. Real image-summary quality and on-device reuse percentages remain for the user's inference test.
