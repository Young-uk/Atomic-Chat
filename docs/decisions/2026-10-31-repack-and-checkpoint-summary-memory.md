# Repack growing handoffs and durably resume completed summary fragments

Status: implemented locally; not published.

A real 52-message recovery completed eighteen merges, then its last handoff
alone exhausted the next request's serialized input budget. Output-limit retries
cannot fix that condition. Before a merge, if the empty-evidence envelope exceeds
5500 bytes, repack only historical handoff text. Split repack input into verified
6000-byte requests if necessary. Require each result to fit a 2800-byte JSON
string, and the merged handoff to fit 3500 bytes. Bound each piece to three
attempts and the hierarchy to three shrinking rounds. Never accept truncated or
oversized output. All original records remain the searchable authority; repacking
can remove incidental detail and repetition while retaining confirmed decisions,
preferences, unresolved work and uncertainty. The original evidence stream and
its position are unchanged by repacking.

Persist each completed fragment and repack before further inference. An optional
versioned checkpoint in the existing immutable-source archive stores offset,
completed count, handoff and a SHA-256 digest of exact evidence, previous handoff,
model, endpoint and summary protocol. A pending archive is never active context.
On restart, reuse a matching frozen snapshot; newer turns remain raw. Edits,
changed prior summaries and changed protocol/model reject stale checkpoints.
Only normal complete inference plus durable final archive publication produces
a ready summary. Existing archives without checkpoints remain compatible.

Normal 70-percent scheduling, recent-turn retention, foreground priority, output
allocation (up to 2048 in the existing 8K slot), original thread files and model
parameters do not change. Legacy failed jobs have no saved partial handoff and
cannot resume work that the old version never persisted.


## Native validation follow-up: reserve output before filling input

The installed-app replay resumed its durable 15-section checkpoint and passed
18 sections, but stopped after section 24. Four output-limit attempts used the
same 1,923-token prompt: halving the nominal 2,400-character ceiling did not
reduce the much smaller byte-limited fragment. Filling 6,000 input bytes also
reduced the conservative output allowance to 1,680 tokens.

Reserve the complete 2,048-token output allowance plus 512 template tokens
before selecting input (5,632 UTF-8 bytes). Repack completed historical memory
when its encoded size exceeds 3,500 bytes, rather than waiting for the empty
merge envelope to reach 5,500 bytes. On truncation halve the actual selected
fragment. Do not commit truncated output or advance the evidence offset.
These tighter execution bounds retain the same evidence and checkpoint memory
representation; existing verified v1 checkpoints can resume without replaying
completed history. Regression coverage uses multilingual evidence whose actual
fragment is smaller than the old nominal retry ceilings.


The first full native replay exposed the section-24 retry issue above. A second
live run against the same local Dstar resumed that durable native checkpoint
(offset 35,527), repacked memory, and completed all 47,404 evidence codepoints
from 52 archived messages in 32 sections (473.9 seconds). The completed handoff
was 2,367 UTF-8 bytes. Repack guidance now also says at most 400 tokens and
short phrases: byte-count guidance alone was not followed by this model.
Original source equality was checked against the pre-checkpoint backup.

The follow-up UTC verify-fast passed (7,782 web tests, 24 skipped; additional
211 and 314 tests). Native Rust code did not change in this follow-up; the
preceding full make verify had passed 1,553 Rust tests. A non-UTC initial rerun
failed two existing date-format expectations; that result is retained separately.
