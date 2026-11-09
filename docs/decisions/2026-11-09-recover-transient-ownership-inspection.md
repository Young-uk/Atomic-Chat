# Recover transient process ownership inspection failures

An installed v31 app logged a Strata ownership inspection failure while the same server runtime and app-owned Python listener remained alive. Read-only status reported a loaded, idle runtime; current lsof and process-tree checks confirmed the expected listener and ancestry. The existing log collapsed OS timeout, diagnostic and process-tree failures into one code, so the original OS failure subtype is not established.

The frontend then latched every error: its polling refresh returned early in error phase, and a chat retry threw the stored error before making any new status request. This contradicted the message that status was being checked again and prevented automatic recovery even after native ownership observations recovered.

For both managed engines, recheck processInspectionFailed through read-only status, including when the current chat retries. Retry a transient owned-target observation at most twice during readiness acquisition. Continue to fail on foreign listeners, unowned readiness, model mismatch and sticky lifecycle/summary errors. Polling never starts or stops an engine; no inference request receives a lease until fresh ownership and the selected model are verified.

Native socket ownership inspection retries one uncertain OS inspection with a fresh process tree and socket query. A positive or negative ownership result is final for that inspection; no historical positive result is reused. Record timeout/spawn/result/process-tree categories without logging command bodies, socket contents or credentials.

Keep the running app, server and installed binaries unchanged while installation is deferred. Validate recovery, exhaustion, foreign-listener refusal, sticky-error handling and existing engine lifecycle tests without model inference.
