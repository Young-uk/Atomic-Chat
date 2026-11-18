# Retry an already-ready managed engine with auxiliary models

Voxtral speech recognition loaded through the built-in core while Strata was already running. The per-request prepare guard treated it as an attempt to launch a second model and stored `otherLocalEngine`. Retry then rejected that sticky coordinator error before checking the runtime again.

An explicit request may now re-evaluate this particular admission error. If preparation still reports another model, a read-only native status must prove the same engine is owned, ready, serving the requested model, free of errors, and (for Strata) already using the desired context. Only then is the existing runtime reused. No engine is launched, stopped, switched, or reconfigured by this fallback, and auxiliary audio models are not unloaded. Initial starts and mismatching/foreign/loading/error/context states retain the admission guard. Other terminal errors retain their existing recovery policies.

Regression tests cover the stale-error Retry path and refusal for each mismatching runtime state.

The ready-runtime reuse exception is restricted to Strata, whose desired and active context are exposed by the native snapshot. Dstar launch policy is unchanged.
