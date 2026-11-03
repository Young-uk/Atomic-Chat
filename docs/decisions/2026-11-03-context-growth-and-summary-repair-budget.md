# Context-growth status and source-repair input budget

## Decision

Show Growing the Mind only while growModelContext is actually pending. A retained continuation message preserves a prior partial answer; it is not evidence that the context is still being expanded. After growth resolves, display the existing request-scoped input progress, including when that continuation placeholder is present. Reset growth state on completion of the operation rather than relying on a later streaming status transition.

Summary evidence selection now budgets the normal prompt and all three possible request-source repair instructions before choosing a fragment. Previously a normal request could fill the slot and leave no room for the user-ID allowlist used by a repair. Every repair still receives exactly the original fragment and previous verified ledger. No evidence or unresolved obligation is silently discarded. The existing think:false setting remains unchanged for merge, repack, repair and token counting.

## Validation

A regression test fills the token budget with a long user-ID allowlist, forces an invalid request source, and verifies successful repair within budget, identical repair input, complete evidence coverage and disabled thinking. Existing inference-progress tests cover actual percentages and phase labels. Run make verify before completion. Installed-app validation is a separate boundary from source tests.
