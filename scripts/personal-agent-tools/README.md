# Personal Chat tools

This worker adds capabilities to the existing Chat transport. It does not load a
second model or execute the standalone Atomic Agent conversation loop.

- `personal_browser`: dedicated installed-Chrome profile; tabs, navigation,
  page text and current element references, click/type, scroll and screenshot.
  Use the existing search connectors to find URLs. Pages remain untrusted data.
- `personal_memory`: explicit cross-chat notes, preferences, procedures and open
  requests with source references; search/list/update/forget. This does not replace
  Chat's summary, archive search, recent context or unresolved-work ledger.
- `personal_tasks`: persistent one-shot and interval text tasks, local Dstar
  background slot, results, cancellation and desktop notification. No unattended
  tool actions. Missed work is visible and is not automatically replayed.
- `personal_watch`: bounded workspace-directory change events, with start/list/
  events/stop. No automatic file content ingestion or command execution.
- `personal_windows`: macOS list/focus/move/resize/minimize through Accessibility.
  Passwords, payment input and arbitrary executable scripts are not window tools.

Existing Chat filesystem, command/script execution, skills, search, MCP services,
conversation archive and summary remain on their existing paths and permissions.

## Install

Install repository dependencies, then run:

```
node scripts/personal-agent-tools/install.mjs --install /absolute/path/to/node
```

Use a supported Node runtime (the Personal Agent runtime's Node 25.7 works).
The installer copies an independent runtime and playwright-core under
`~/Library/Application Support/Atomic Chat Personal Tools`, backs up the existing
MCP configuration, merges only `atomic-personal-tools`, and leaves it disabled.
Enable it in the new Personal Chat's Connectors screen. The Personal tools panel
appears there after enabling. The chat's explicit approval mode controls calls;
the global MCP permission switch does not auto-approve personal desktop tools.

Keep the connector disabled in the official app: both applications currently use
Atomic Chat's shared MCP configuration. Do not run two workers against the same
personal data directory simultaneously. The worker serializes operations inside
one process; this is not a multi-process database service.

Tasks run only while the MCP worker is connected. Dstar must expose its dedicated
summary slot. The fixed loopback endpoint/model are installer settings; no model
files are copied or downloaded. A failed or output-limited task is marked failed,
not presented as a successful answer. Completed results can be inspected in
Connectors or by asking Chat to list scheduled tasks.

## Verify

```
node --test scripts/personal-agent-tools/*.test.mjs
make verify
```

Use synthetic notes/tasks and a separate browser profile during QA. Never use
existing private conversation history or model files as destructive fixtures.

## Remaining differences from standalone Atomic Agent

The five tools above are bounded additions, not complete Agent parity. The source
comparison below uses the local Agent checkout from 2026-11-01, not a live upstream
inventory.

| Area | Personal Chat status | Still absent from this worker |
| --- | --- | --- |
| Browser | Dedicated Chrome navigation, reads and element actions | No attach-to-existing-browser workflow or Agent browser profile migration |
| Memory | Explicit source-bearing notes/preferences/procedures/open requests | Automatic contextual recall, hybrid semantic search, profile version history, memory links, lessons/reflection and consolidation |
| Tasks | One-shot ISO times, intervals and local text results | Cron syntax/timezones, webhook triggers, durable agent/tool turns, external delivery and execution while Chat is closed |
| Workspace events | Bounded file-event collection | Persistent watchers and event-triggered workflows |
| Desktop | Window controls; task-result notifications | Clipboard tool and the Agent's full desktop integration |
| Files/Git/documents/verification | Existing Chat commands/scripts, attachments and skills remain available | Dedicated Agent structured filesystem, Git/GitHub, document extraction, syntax checks and throwaway-workspace verification tools are not ported |
| Collaboration | Existing Chat inference path | Fusion orchestrator/worker delegation and result contracts |
| Remote services | Existing Chat MCP connectors | Agent Telegram/Discord/Swarm channels, Composio setup and Agent-specific integrations |

Some capabilities can already be performed through approved Chat commands or MCP
connectors; that is not equivalent to having the Agent's dedicated tools and UI.
No new credentials, remote channels or unattended execution are enabled by this
inventory.
