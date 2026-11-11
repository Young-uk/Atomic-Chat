# Recover unambiguous Personal tool calls and expose diagnostic log tails

Recent model calls omitted action while supplying native name/input or a document path. They failed before dispatch with Unknown action, repeatedly. Normalize only those unambiguous shapes. Explicit invalid actions and ambiguous custom-tool definitions still fail; native schema validation and immutable proposal approval remain authoritative.

Expose actual application and runtime logs through personal_document action=logs and fixed source IDs. General document reads remain confined to the Personal workspace. Diagnostic reads accept no arbitrary paths, reject file symlinks, and return at most the last 256 KiB and 500 lines as untrusted text, with common credential fields redacted. Log access follows the existing MCP permission policy. Missing logs remain errors rather than fabricated evidence.

Regression coverage reproduces omitted-action native write/shell calls, verifies no execution before approval, exercises document confinement, and checks bounded log tails, redaction, source validation and symlink rejection.
