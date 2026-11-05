# Preserve configuration order across compaction

Compaction must retain the original leading tool catalog, tool policy, and
reasoning-effort snapshot in their original order. Replaying a newer retained
catalog before the original effort anchor changed the fixed system prefix:
live diagnosis found the first mismatch at token 13,556 and a cold replay of
33,969 tokens despite a usable preceding conversation cache.

When the original user anchor has been compacted, expand its immutable catalog
and policy first. Place the first retained user before any newer catalog/policy
updates; effort expansion then restores the original effort anchor before that
user and appends newer effort after it. Both updated configurations still apply
before generating the assistant response. The execution allowlist is unchanged.
Uncompacted histories retain their previous serialization.

A combined regression covers changed catalogs and effort, JSON restart replay,
and an unchanged uncompacted prompt. This restores a prerequisite for retained
history reuse; it does not guarantee reuse for images or arbitrary prompt edits.

## Integrated recovery behavior

After compaction, context usage is estimated from the same projected image and
attachment messages used by the foreground request. Screenshot base64 retained
in storage must not inflate the text-token estimate.

Context growth continues the existing assistant message ID and retains completed
tool results and visible text. It does not regenerate the assistant or replay its
completed tool calls. Context growth uses the last request context usage rather
than cumulative multi-step billing usage.

Error-induced queue pauses recover after 5, 10, 20, 32 and then 64 seconds,
capped at 64 seconds. A successful turn resets the delay. Explicit pause and Stop
cancel automatic recovery. Recovery dispatches only remaining queued messages;
it never silently replays a failed request or completed tool side effects. The
queue shows the recovery countdown separately from a manual pause.

The accompanying Personal Dstar changes enable guarded approximate retained
history reuse by default, preserve valid disk entries on user cancellation, and
hold background summary GPU work while a foreground request is active. The
current GPU quantum cannot be preempted. Approximate history retains earlier
recurrent-state influence; it is not an exact recomputation and is not persisted
as an exact disk checkpoint. Image and unsupported backend paths retain their
exact-rebuild guards. DS4_ATOMIC_HISTORY_CACHE=0 disables the approximation.


## Recovery budget consistency

Foreground preflight counts only the current serialized prompt envelope, including
system folding, tools, continuation and output reserve. Prior assistant usage
belongs to a different request and must not reject a now-fitting prompt. Recovery
previews use the same system-folding rules. Diagnostic records contain counts,
archive boundaries and resume/wait decisions without transcript content. Recovery
still waits for another durable batch if the first batch does not free enough space.

## Pre-output recovery adopts its verified snapshot

A tool continuation normally freezes its active summary. Emergency recovery
must commit the fitting verified snapshot before retrying that continuation;
otherwise preview accepts the newer summary while the retry sends the older
oversized context. This exception applies before output starts and preserves
completed tool results. A regression checks that normal tool steps remain frozen
and that a recovered tool step uses exactly the accepted preview.
