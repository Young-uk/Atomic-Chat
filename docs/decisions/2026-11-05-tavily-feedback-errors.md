# Tavily feedback: preserve tool failures and cooldown metadata

## Evidence

Winter's stored tool results include a Tavily crawl response with status 429,
followed by search/extract failures rendered as `Error: {}`. The latter do not
prove additional remote rate-limit responses: the shared local cooldown throws
an Error, and the tool executor serialized non-enumerable Error fields to `{}`.
Request counts alone do not establish the provider's rate-limit scope.

## Change

Preserve Error.message in model-facing thrown and returned tool failures.
Inspect structured thrown status, Retry-After and Error causes for the shared
Tavily cooldown instead of converting exceptions to strings first. Recognize
explicit nested error messages while excluding ordinary article text mentioning
HTTP 429. Retain existing defaults, endpoint-wide cooldown, duplicate suppression
and user-selected search depth. No automatic requests or credential changes.

## Verification

Focused executor/policy regression tests cover readable thrown errors, structured
429 with Retry-After, cross-endpoint blocking, expiry and article-text false
positives. Full verification is run separately; no paid live Tavily calls are
needed to reproduce the local serialization defect. No runtime tool-registration
feature is introduced by this fix.

Focused regression: 24 tests passed. Full `make verify` passed Personal tools
(67), lint (warnings only), typecheck, quality and hardening checks; the web
coverage suite passed 7,937 tests but failed two pre-existing formatDate tests
that assume UTC while this host uses Asia/Seoul. Native tests were not reached
because that target stopped. No installed-app replacement or push in this task.
