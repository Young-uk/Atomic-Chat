# Completed cache receipts and personal build verification

## Problem

A completed foreground conversation's semantic cache receipt was recorded only inside background compaction scheduling, after its admission check, and without awaiting the HTTP acknowledgment. A disabled/deferred summary could therefore leave a cleanly saved native session without a verified clone binding. Generic release builds also omit the personal frontend feature gates even when the managed native server advertises summary support.

## Decision

Record the completed Strata history independently of compaction scheduling and admission. Await the existing bounded receipt request before marking the foreground request complete and before scheduling summaries or background memory work. Failed, aborted, truncated and tool-pending responses never attest a completed history. Receipt failure retains the successful answer and ordinary cache; it never creates a clone binding. Require the server's `saved: true` acknowledgment, not HTTP status alone.

Use `build:personal` for the personal app. Emit a non-sensitive `atomic-build.json` asset with the three frontend feature gates and verify it after the personal build. The install preparation must check this manifest as well as source hashes and code signing. Server discovery alone does not prove that frontend compaction was compiled in.

## Validation and limits

Transport tests verify receipt recording with compaction disabled, waiting for acknowledgment, and excluding incomplete/tool-pending responses. Receipt tests reject changed-owner acknowledgments. The personal build guard rejects generic/incomplete manifests. Run `make verify`, applicable Rust checks, the personal release build and artifact guard before installation. Confirm a real completed turn can persist a semantic receipt across normal shutdown/restart using an isolated fixture.

An application killed before the bounded completion acknowledgment can still retain only ordinary inference state. Never fabricate missing history hashes or relax native checkpoint validation. This change does not alter summary/review scheduling, parallel slots, model arithmetic or memory limits.
