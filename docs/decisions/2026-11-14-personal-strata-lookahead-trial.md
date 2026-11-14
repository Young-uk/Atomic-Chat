# Personal Strata two-layer expert read-ahead trial

## Decision

Enable the existing `STRATA_METAL_PREFETCH2=2` option in the personal Strata profile at the user's request. It predicts two experts for the layer after next. This is expert I/O read-ahead, not MTP or speculative token generation. Keep the native/backend binaries, original IQ3/IQ4 weights, 4096-row input chunks, automatic memory budget, context policy, summary/review and parallel configuration unchanged. The demand-only prompt prototype is excluded.

## Evidence and limits

On this M1 Max, 63 matched HTTP requests with three rotated-order repetitions found about 5% aggregate decode improvement, including about 10% for code, with regressions in individual repetitions. Ten additional native long-history requests reused 42,994 tokens and produced identical token sequences. Two-layer read-ahead improved long-history decode by about 0.5%; no universal speed benefit is claimed. Comparisons fixed the expert arena at 24 GB; production retains its automatic budget. This is a user-selected trial, not a general recommendation or a Dstar change.

## Cache compatibility and rollback

The launch fingerprint changes with this option. After verifying the pinned baseline, compute one exact prior-policy identity by removing only this setting from the same generated context/weights/cache policy. Preserve native and backend hash checks and native archive geometry/payload validation. Verify the existing saved archive restores before delivery. Reverting the trial requires restoring the old launch option and qualifying the exact read-ahead-policy archive identity; never discard the user's conversation cache merely to toggle it.
