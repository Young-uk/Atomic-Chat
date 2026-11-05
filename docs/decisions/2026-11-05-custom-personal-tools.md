# Model-authored reusable Personal tools

## Contract

Winter can register a `custom.lowercase_name` with a description, documentation
reference, a supported JSON input schema and an async JavaScript function body.
Definitions live in the existing Personal state transaction, alongside but separate
from memories and tasks. No new configuration file or dependency is introduced.
Catalog and describe expose the saved tool; `personal_native.run` invokes it. This
stable dispatcher avoids changing the model's top-level tool prefix after each
registration. Removing a definition unregisters it without touching other tools.

## Execution and approval

Registration never executes code. Each invocation produces the existing immutable
native approval proposal containing the full definition, revision and arguments.
The app inspects that proposal before confirmation. Edits invalidate pending and
remembered exact-action approvals. Code runs as the host user in a child Node
process, not a sandbox, with a 30-second execution and 256 KiB output bound.
The child does not inherit connector credential environment variables. Use existing
approved configuration/credential mechanisms; never embed secrets in definitions.
Code receives `input`, may await fetch, and must return JSON without logging to
stdout. Unsupported schema features are rejected rather than ignored.

## App-control audit

Personal windows supports list/focus/move/resize/minimize/restore and accessibility
permission checks. Personal browser controls dedicated Chrome tabs through current
page references. Source-native os.screen capture/click/type/key implementations
are present, but PersonalNativeSuite defaults screenEnabled=false; the Chat worker
currently does not enable them. This change does not silently grant desktop input
or screen-recording rights or claim desktop parity with Codex computer-use tools.

## Validation

Synthetic tests cover real child execution after approval, no execution before
approval, persistence across restart, invalid input/schema rejection, confirmation
consumption, code-change invalidation, removal and Chat-adapter catalog/describe/run
integration. No real API credentials or external side effects are used.
