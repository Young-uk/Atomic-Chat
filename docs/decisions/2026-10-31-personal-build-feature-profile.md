# Personal build feature profile

The Personal deployment accidentally used the ordinary Tauri build command,
which omitted compile-time flags for append-only effort, background compaction,
and the managed summary slot. Source presence did not imply runtime activation.

Use `yarn build:personal` for Personal deployments. It sets
`VITE_PERSONAL_BUILD`, `VITE_DSTAR_APPEND_EFFORT`,
`VITE_DSTAR_BACKGROUND_COMPACTION`, and `ATOMIC_DSTAR_SUMMARY_TEST` together.
The regular Tauri before-build command still sets `IS_TAURI=true`.
Ordinary upstream builds remain unchanged. This restores previously authorized
behavior; it does not change summarization thresholds or scheduling.

Verify the installed executable, server `/v1/models` summary-slot capability,
and actual archived-summary recovery before reporting a successful deployment.
Models remain on the internal SSD; SD model loading is excluded.

## Deployment verification (2026-10-31)

The installed Personal executable was rebuilt with all four flags and verified
with strict code signing. The matching Dstar server exposes
`atomic_summary_slot: true` with a 65,536-token foreground context. Models use
the internal SSD; the rejected SD model experiment is not part of the code.

The existing conversation recovered using its archived summary: a 44,892-token
request completed, and the following request reused 45,094 tokens while reading
45 new tokens. The installed app displayed summarization after the answer.
The actual-server checkpoint test passed repacking, durable save, interruption,
and resume through all 5,800 evidence characters in three completed sections.
Existing archives were preserved. This does not claim the ongoing historical
open-request-ledger migration has finished.

Focused tests: 139 passed. Web tests: 7,792 passed, 25 skipped under UTC.
Initial local-time date expectations failed; rerunning under UTC passed.
Extension coverage suites passed 211 and 314 tests with Node 22's
`--experimental-require-module`; the initial extension launch lacked that
compatibility flag. Coverage floors passed for 13 critical files. The release
build passed; native Rust tests were not repeated for this package-script and
documentation repair (native source unchanged).

Restart KV-cache staging previously failed with `ENOSPC`, causing a full first
prefill rather than proving a cache-matching regression. Live follow-up reuse
passed. Unused test/build caches were subsequently removed with user approval;
restart durability after that cleanup has not been retested, to avoid stopping
the active conversation summary. Source, installed app, models, active caches,
and original conversation archives were retained.
