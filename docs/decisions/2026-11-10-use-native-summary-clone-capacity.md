---
date: 2026-11-10
title: "Use native physical capacity for cached summary recovery"
---

# Use native physical capacity for cached summary recovery

- **Context:** a 64K foreground session can already own 64,843 cached tokens. The Metal window reserves 8,192 extra cells for clone instructions and output, plus alignment, but clone capability discovery reported only the 65,536-token logical foreground limit. The Python preflight therefore rejected cached summaries before they could use the reserved space, switching to independent extraction.
- **Decision:** native clone discovery reports both the unchanged foreground limit and its actual allocated capacity. The server validates and uses that capacity for cached summary admission and remaining output room. Serial disk-preserved recovery enforces the same physical limit. Legacy three-field discovery keeps the old limit. No capacity is inferred from configuration, and no new KV allocation or foreground context expansion is introduced. The CPU/GPU image position tables use the same checked capacity as KV storage, so appending through the reserved region cannot overrun a 64K-only position table.
- **Limits:** a genuinely full physical window or exhausted absolute positions still refuses the clone and preserves originals. Earlier-checkpoint cloning is a separate future extension; it is not part of this fix. The output remains uncapped by a prose target and bounded by actual physical space.
- **Compatibility:** this protocol/admission change leaves token, KV and recurrent-state serialization unchanged. Only exact reviewed predecessor identities are admitted for 64K session restoration; the native reader still validates the file. Runtime qualification pins are updated for the new native and Python pair.
- **Validation:** protocol discovery, legacy fallback, physical overflow refusal, full-logical-context admission and rollback are covered by fake-engine tests. Installation additionally requires real inference on an independent copy of the existing cache and an unchanged original manifest/session, plus the app verification gate and signature checks.
- **Owner:** personal Strata integration. The previous throughput experiments remain disabled and are not included in this native build.
