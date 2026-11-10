---
date: 2026-11-10
title: "Continue background summaries after headroom refusal"
---

# 2026-11-10 — Continue background summaries after headroom refusal

- **Context:** cached summary headroom fallback was attached only to foreground-blocking recovery. Ordinary post-answer summaries at 98% usage failed immediately even though independent disk-preserved extraction was available.
- **Decision:** give both cached adapters a capacity fallback. A normal scheduling task transfers to the existing bounded-batch coordinator only after explicit headroom refusal, retaining its frozen evidence. It waits for local foreground work and, for disk-preserved Strata work, native foreground activity to become idle before generation. The native exclusive-save gate remains authoritative; only its exact clean idle race may retry. Use the latest completed owner at the same endpoint when preserving a cache that advanced while waiting. Do not change ordinary cached summary concurrency or retry arbitrary failures. A foreground-blocking recovery cancels an idle background wait and promotes it through the existing recovery path.
- **Consequences:** background capacity failures no longer require a subsequent oversized foreground request to trigger recovery. Original UI messages and newer dialogue remain intact; validation and durable ledgers remain unchanged. Cold work starts when idle but must retain exclusive native ownership until its saved main is restored, so a conversation arriving after that point waits for the existing critical section. No new lock, model inference test, token quantum or wall-clock cutoff is introduced.
- **Owner:** personal fork.
- **Links:** `web-app/src/lib/dstar-context-compaction.ts`, `web-app/src/lib/strata-cached-summary.ts`, `web-app/src/lib/dstar-summary-idle.ts`, `web-app/src/lib/dstar-summary-batches.ts`.

Restored-cache startup handoff is already awaited by a pending foreground request. Mark that path as recovery so its capacity fallback never waits for the very client lease that depends on it.

Dstar background extraction keeps normal native priority because its summary state is isolated. Only Strata disk-preserved work needs the native recovery flag while temporarily using the main state; explicit foreground-blocking recovery keeps its existing priority. Background extraction still has no wall-clock deadline.
