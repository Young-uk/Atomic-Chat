# Keep summary source before changing memory

Summary merges previously serialized prior memory and work items before source evidence. This invalidated the source prefix when memory changed. Serialize evidence first, followed by prior memory, work items and fragment metadata. Repair instructions remain after the unchanged source envelope. This does not make unrelated source fragments reusable or enable approximate KV reuse.

Memoize exact rendered prompt token counts within one summary invocation. The key includes every message and instruction; output reservation is checked separately. No counts survive a model change or another invocation.

Preserve the 60% trigger, complete-turn selection, 13,312-token input budget, five-batch consolidation, evidence validation and persisted checkpoints. Existing checkpoint semantic keys remain valid because source meaning is unchanged.

Validation: archive and rendered-budget regression tests cover evidence preservation, bounded retries, checkpoint resume, request-ledger validation, source-first serialization and duplicate count elimination. Installed-app latency remains to be measured after deployment.
