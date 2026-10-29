# Personal builds show official release notices without installing them

## Context

Installing an official update from a Personal build replaces the application bundle and removes fork-only behavior. Release discovery remains useful, and a separately installed official app should retain its normal updater.

## Decision

Build Personal distributions with `VITE_PERSONAL_BUILD=true`. Keep official release checks, release notes, and external release links. Omit the installation action from the application update banner. Guard both the updater hook and desktop service entry points before stopping models, downloading, or restarting. Leave the flag unset for official distributions. Engine updates remain independent and installable.

The integration targets upstream app v2.2.29 and core v0.20.4. Port the existing loopback stream lifetime fix onto that core version rather than shipping the older core binary.

## Verification

Updater service, hook, and banner regressions cover release discovery, link navigation, and blocked installation, alongside existing official update tests. A Personal release build must explicitly set the flag; a default upstream build does not enable this policy.
