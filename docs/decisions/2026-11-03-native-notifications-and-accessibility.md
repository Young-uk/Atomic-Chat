# Native notifications and Accessibility permission requests

## Decision

Update node-notifier from 10.0.1 to 12.1.0 and deploy the Personal worker with Node 24 LTS (at least 24.15.0). The old bundled terminal-notifier executable is x86_64-only and produces a future-macOS compatibility warning on Apple Silicon. The new notification helper contains arm64 and x86_64 slices. Node 25 is outside the new package's supported engine range, so validate SQLite ABI and all Personal tools on the replacement runtime before deployment.

Window control now checks Accessibility through the same osascript host that executes window operations. Its first approved window operation requests macOS permission once per worker; denial returns actionable, non-retryable permission state without reading or changing windows. The explicit permissions action probes without prompting; request_permission requests again. A permission revocation between probe and operation is handled identically. No TCC database changes, automatic grants, or permission reset are performed. The responsible app displayed by macOS must be authorized by the user.

Preserve the previous installed node-notifier package by renaming it outside node_modules before copying its replacement. Overlaying releases leaves removed bundle resources behind: live validation found legacy MainMenu.nib and Credits.rtf files invalidating the new helper's signed resource seal. A clean replacement passed strict codesign verification and the next in-app notification call returned ok. Desktop presentation still depends on macOS notification settings.

## Validation

Run the Personal tool suites and make verify under Node 24. Check the installed helper architecture and worker ABI. Live notification delivery and Accessibility authorization are separate UI checks; successful process exit alone is not proof of a displayed notification or granted permission.
