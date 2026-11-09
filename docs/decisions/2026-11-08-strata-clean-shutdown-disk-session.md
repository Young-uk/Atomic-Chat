# Preserve the drained Strata foreground session across clean restarts

Personal Strata now opts into a private disk session directory. The separate runtime-cache-v13 restores a compatible native session before enabling summary scheduling or accepting requests. It saves only after HTTP admission drains, summary ownership is idle and both weighted continuation owners and waiters have released their permits. Native session validation remains authoritative; active or uncertain state is never saved. A restore failure restarts cold before accepting requests.

The cache is one latest foreground session, not every parked conversation. Its identity binds the actual native executable, model/tokenizer/pack/config fingerprint and server sources, including the persistence helper. Files are private; a new generation and fsynced manifest replace the published record before removing the old generation. A failed save preserves the previous published snapshot. Forced termination, crashes before a save, incompatible identities and native resource refusal can still require a cold input read. The existing v12 runtime is preserved for rollback. The initial transition cannot export a live v12 weighted session through its disabled slot API.

Validation uses mocked native session operations and existing priority/state-bank suites; no new model prompts are submitted. Real foreground cache reuse after a restored restart remains a user-run check.

## Backup compatibility

Installation backups must copy a session into an independent file, never create a hard link to the live checkpoint. Native restore requires a regular file with exactly one name (`st_nlink == 1`). A hard-link backup preserves the bytes but makes the live checkpoint fail that validation. Verify independent file identity and unchanged contents before publishing a backup; keep the native validation enabled.
