# Bind Personal verification to the originating chat workdir

Chat scripts run under agent-workspace/chat/<thread id>, while Personal syntax
verification previously resolved relative paths against agent-workspace. A file
created by run_script therefore failed verification by its relative filename.

The Chat dispatcher now supplies the actual originating thread id for
personal_verify, overriding model-authored context. The worker resolves relative
filenames in that chat directory. Callers without thread context retain the
shared-root behavior; absolute paths still undergo the existing workspace and
realpath checks. No filename search or fallback to another chat is performed.
The model-facing schema and approval policy remain unchanged. Other Personal
file tools are outside this focused correction.

Regression coverage checks a valid chat-local Python file against a conflicting
invalid root file, legacy root behavior, invalid thread ids and symlink escape.
