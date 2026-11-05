# Strict JSON verification in Personal tools

Personal syntax verification previously reused a write-time parser that accepts JSONC for most JSON filenames. This let a trailing comma pass and incorrectly labelled the checker as node-vm.

Verify `.json` files with JSON.parse only. Accept comments and trailing commas only for explicit `.jsonc` verification, and report JSON.parse or JSONC.parse respectively. Keep the shared write-time configuration parser unchanged to avoid changing file-edit policy. Verification never executes source or rewrites the checked files.

Regression coverage includes invalid JSON trailing commas and comments, valid string literals containing comment-like text, explicit JSONC, and malformed JSONC. Both vendored source entry points and generated runtime modules are updated.
