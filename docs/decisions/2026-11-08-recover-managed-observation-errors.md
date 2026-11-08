# Recover managed engine observation errors

Date: 2026-11-08

## Context
A transient listener-ownership lookup was stored as a global lifecycle error. Later verified ownership did not clear it, so an owned live Strata server could remain unusable in chat and poison the inactive Dstar panel.

## Decision
Keep observation errors on the owned process generation, separate from sticky lifecycle errors. Inspection failures and confirmed foreign listeners remain distinct. Only a fresh nonempty models response plus verified listener ownership clears an observation fault. Periodic probes retry after earlier readiness. Preserve the ever-ready flag for authenticated summary draining and idle checks. Scope lifecycle errors to their engine and retain genuine lifecycle failures.

## Verification and limitations
Mock regressions cover failed, empty, foreign, and successful observations, sticky faults, generation cleanup, and inactive-panel isolation. No real model conversation was run. The original transient lookup failure was not logged, so its exact environmental trigger is unknown.
