# Display live Strata endpoint status separately from manual checks

## Context

A configured custom provider was labeled Connected even after its owned Strata
process stopped. Manual endpoint checks and saved model lists describe earlier
configuration, not the current lifecycle.

## Decision

- The exact registered loopback Strata identity uses native status-only polling,
  shared by its endpoint header and lifecycle controls. It does not load a model,
  change selection, write configuration, or probe arbitrary URLs.
- Recognition for status remains valid when the provider is disabled for chat.
  Lifecycle privileges retain their existing active-provider guard.
- Native status, including external/unowned listeners, is distinct from manual
  Test Connection results. Cached or delayed manual replies cannot override it.
- Ready requires the expected engine, ownership, and served model. A snapshot
  for the other engine means Strata is stopped, not that Strata is ready.
- Observations are memory-only and scoped to mounted observers. Hide stale ready
  on backgrounding, resume with a fresh read, and invalidate in-flight reads on
  lifecycle actions, coordinator changes, and observer teardown.
- Failed status reads replace ready with an unverified state and retry. A five-
  second freshness watchdog also invalidates ready if IPC stalls; keep a single
  outstanding native status request rather than flooding a blocked actor. External
  endpoint and Dstar behavior remain unchanged.

## Verification

Mock-only tests cover cached results, shared polling, stopped and external
states, wrong model/engine, inactive configuration, read failures, stop races,
engine switching, unmount/remount, and background/foreground transitions.
Chromium layout coverage includes 1024/1280 windows, Medium/Extra Large text,
English/Korean, and both themes. No engine is started or stopped by these tests.
