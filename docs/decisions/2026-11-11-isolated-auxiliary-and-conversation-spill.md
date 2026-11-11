# Isolate local auxiliary work and spill displaced conversation state

The personal Strata configuration opts into a bounded Metal conversation spill
tier. Memory parking and physical-memory admission remain the first choice.
If a snapshot cannot be parked, its authoritative KV is streamed to a private
process-local directory. LRU evictions can also write their existing host image.
Only a longer exact token/image/steering match is loaded, through the existing
native identity, checksum, geometry and physical-memory checks. Failed reads
remain cache misses. The normal clean-shutdown startup manifest is unchanged.

The spill tier holds at most 4 GiB and eight files. It removes its directory on
normal exit and reaps only same-user spill directories of dead processes on the
next startup. It is an auxiliary cache, not conversation storage.

Hermes approval and title requests use the existing isolated non-thinking lane.
Structured output is allowed only with the explicit `atomic_auxiliary` marker;
ordinary summary requests retain their existing text-only contract. Tools remain
forbidden in this lane. Normal tool-result continuations remain foreground work.

The personal app pins the reviewed native/runtime artifacts and explicitly
bridges the exact previous 128K artifact triple. Native session layout and model
arithmetic are unchanged. Other identities continue to fail closed.
