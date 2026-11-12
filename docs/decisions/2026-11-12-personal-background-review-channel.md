# Personal background learning review channel

## Context

The Personal build already forms memories after completed turns and pauses this work for chat and summarization. Add useful corrections and reproducible procedures without giving a background agent arbitrary write tools or changing completion review.

## Decision

Use one private inference channel for memory formation and learning review. On supported Strata servers, request the existing conversation cache clone, sharing model weights while isolating inference state. Known stale/headroom/admission rejections fall back once to the isolated text bank with a bounded evidence window; other failures save no learning changes. Original memory output-only tool emission is adapted to JSON because native background banks reject general tools.

The review is opt-in in the existing Personal feature settings. Foreground activity aborts and requeues it. It has no fixed generation token cap and only runs on completed turns with observed corrections or successful tool results. Reasoning and progress announcements are excluded. Lessons require exact source quotes; every procedure step requires successful tool evidence. The host validates all proposals before committing review changes atomically.

Store review revisions and their source references in the existing notes SQLite database. Recall at most three relevant entries on future turns through the existing immutable memory snapshots. Standing guidance requires an explicit durable user preference; procedures are contextual. Users can inspect recent learning changes and undo them, restoring prior revisions. Undo is limited to learning changes, not the existing profile extractor's separate writes. Do not edit original skill files, execute arbitrary actions, change summary policy, or change completion review.

## Consequences

A separate channel does not imply automatic cache sharing: cloning is capability-specific and may fall back when unavailable. Learning is best effort and never blocks a chat answer. Saved guidance is evidence-backed but model-generated; history and reversible changes remain essential. Disabling review stops new reviews; previously accepted guidance remains until undone.
