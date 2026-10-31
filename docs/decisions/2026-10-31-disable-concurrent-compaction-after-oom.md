# Disable concurrent compaction after long-context Metal OOM

Status: rollback authorized; background compaction disabled by default.
Supersedes the deployment status of 2026-10-31-background-context-archives.md.

## Observed failure

On the installed M1 Max 64 GiB machine, slot 1 prefilling a 27,142-token summary
ran alongside slot 0 restoring a 58,434-token conversation and appending 464
tokens. At 03:20:31 KST the Metal batch failed with Insufficient Memory. Both
requests ended in error during speculative decode. Short synthetic concurrent
streams and allocated context estimates did not validate this combined live
memory peak. The UI Ready state was not proof that generation remained usable.

## Immediate recovery

Restore the pre-compaction Personal executable and server from their verified
backups. Keep all current conversation files and archives. Remove automatic
`--summary-slot` startup from source. Require explicit
`VITE_DSTAR_BACKGROUND_COMPACTION=true` before foreground transport can prepare
background summaries; ordinary Personal builds leave it unset. Preserve the
experimental source for further work; do not publish the experiment as safe.

Single-slot recovery removes this concurrent workload, but does not make an
already full conversation fit again. Re-test the real failure class with long
resident caches, actual summary length, and peak Metal allocation before any
future concurrent re-enable. No memory-reduction algorithm is selected here.
