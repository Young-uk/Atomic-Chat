# Browser screen input approval

- **Context** — The desktop input tool refused every browser action by bundle ID.
- **Decision** — Allow recognized navigation and search input using live macOS accessibility metadata. Ask for a fresh decision when the target appears sensitive or cannot be confidently classified. Recheck the target metadata after approval and preserve other protected-app and shortcut rules.
- **Consequences** — Browser controls that expose little metadata still ask. Accessibility metadata is heuristic and cannot establish what arbitrary page code will do. Structured browser tools remain available for page-level inspection.
