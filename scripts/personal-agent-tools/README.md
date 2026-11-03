# Personal Chat tools

This worker adds capabilities to the existing Chat transport. It does not load a
second model or execute the standalone Atomic Agent conversation loop.

Direct source migration is in progress. Selected Agent domain modules live in
`agent-source/` with MIT license and provenance; no `atomic-agent` runtime is
required. Source availability is not full feature parity or installed-app QA.

- `personal_verify`: ported syntax checking, workspace boundary, explicit
  unchecked results and no source execution.
- `personal_document`: ported document extractors for PDF, DOCX, DOC, XLSX,
  PPTX, ODT, RTF and plain text; bounded workspace inputs and explicit truncation.
- `personal_notes`: ported SQLite FTS5 notes with source references, separate
  from the legacy memory JSON. Recall is captured once per new Personal
  Dstar user turn. Optional local hybrid embedding search and bounded reference-query rewriting are connected but off until configured in the Personal tools panel. Source-grounded reflection runs after completed replies only while chat and conversation summaries are idle. New foreground work aborts and requeues reflection.
- `personal_native`: discover and describe the original OS tool schemas, then
  invoke the directly ported file, shell, Git, web and desktop tools. Native
  guarded actions return an expiring proposal for a separate human confirmation.
  The confirmation modal loads the worker's stored request and arguments.
  Changed plans require fresh approval; remote Git synchronization is disabled.
  Chat now supports provider-bound Always allow grants and a General settings revocation panel. Native stored action confirmations remain fresh per proposal. Read-scope grants are invocation-scoped until authenticated Chat session
  lifecycle wiring is available. Detached shell jobs do not survive an invocation.
  GitHub uses explicitly configured credentials; mail receives only Chat-owned configuration. The browser Chat path requires a fresh human approval for every stored native proposal, ignoring remembered grants even in Full access. The separate native agent runner does not receive this adapter until it supports the same contract; its existing built-in file/Git tools are unchanged. This source adapter is not a claim of complete Agent feature parity.

- `personal_browser`: dedicated installed-Chrome profile; tabs, navigation,
  page text and current element references, click/type, scroll and screenshot.
  Use the existing search connectors to find URLs. Pages remain untrusted data.
- `personal_memory`: explicit cross-chat notes, preferences, procedures and open
  requests with source references; search/list/update/forget. This does not replace
  Chat's summary, archive search, recent context or unresolved-work ledger.
- `personal_tasks`: persistent one-shot and interval text tasks, local Dstar
  background slot, results, cancellation and desktop notification. No unattended
  tool actions. Missed work is visible and is not automatically replayed.
  Cron expressions and IANA timezones use the ported Agent scheduling helpers;
  `preview` reports the next five firing times before creation.
- `personal_watch`: bounded workspace-directory change events, with start/list/
  events/stop. No automatic file content ingestion or command execution.
- `personal_windows`: macOS list/focus/move/resize/minimize/restore through Accessibility. Lists and action results include `minimized`: `true`, `false`, or `"unknown"` when unavailable.
  Passwords, payment input and arbitrary executable scripts are not window tools.

Existing Chat filesystem, command/script execution, skills, search, MCP services,
conversation archive and summary remain on their existing paths and permissions.

## Install

Install repository dependencies, then run:

```
node scripts/personal-agent-tools/install.mjs --install /absolute/path/to/node
```

Use Node 24 LTS >=24.15.0 (or another version supported by all runtime dependencies). Node 25 is not in node-notifier 12's supported engine range. The installer checks the SQLite ABI before replacing the worker.
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

After modifying vendored TypeScript, rebuild the checked-in runtime modules with
`node scripts/personal-agent-tools/build-agent-source.mjs`. The installer checks
SQLite against the selected Node before replacing worker files, then copies
the installed dependency graph; it never copies the standalone Agent runtime.

Use synthetic notes/tasks and a separate browser profile during QA. Never use
existing private conversation history or model files as destructive fixtures.

## Remaining differences from standalone Atomic Agent

The connected tools above are bounded additions, not complete Agent parity. The source
comparison below uses the local Agent checkout from 2026-11-01, not a live upstream
inventory.

| Area | Personal Chat status | Still absent from this worker |
| --- | --- | --- |
| Browser | Dedicated Chrome navigation, reads and element actions | No attach-to-existing-browser workflow or Agent browser profile migration |
| Memory | Legacy explicit memories; source-backed FTS5 notes, profile history, note links, lessons and procedures; immutable per-turn keyword recall for Personal Dstar | Optional local hybrid embeddings, query rewriting, idle link generation and consolidation are connected but default off; voting remains absent |
| Tasks | One-shot ISO times, intervals, cron/timezone previews and local text results | Webhook triggers, durable tool turns, external delivery and execution while Chat is closed |
| Workspace events | Bounded file events and opt-in same-id persistent watch definitions | Event-triggered tool workflows; events themselves are not persisted |
| Desktop | Window controls; task-result notifications | Source clipboard tools are connected; optional screen control remains disabled until explicitly configured |
| Files/Git/documents/verification | Ported document extraction and syntax checks; existing Chat commands/scripts, attachments and skills remain available | Source filesystem/Git/GitHub and throwaway-workspace verification tools are connected; detached shell jobs still need authenticated session lifecycle wiring |
| Collaboration | Existing Chat inference path | Fusion orchestrator/worker delegation and result contracts |
| Remote services | Existing Chat MCP connectors | Agent Telegram/Discord/Swarm channels, Composio setup and Agent-specific integrations |

Some capabilities can already be performed through approved Chat commands or MCP
connectors; that is not equivalent to having the Agent's dedicated tools and UI.
No new credentials, remote channels or unattended execution are enabled by this
inventory.

## Personal Dstar automatic recall

For an enabled Personal tools connector, new Personal Dstar user turns perform
a bounded grounded-profile and FTS5 lookup (up to 750 ms best effort). The selected source-bearing
evidence is persisted once in that user message's hidden metadata, then replayed
as historical data immediately before its text. At most three source-gated profile facts precede relevant notes inside the existing five-entry, 4,000-character snapshot budget. Profile facts use versioned database references; ungrounded names are excluded. Older snapshots are not
recomputed when notes change or the connector is disabled. No global system
prefix is changed. Other providers and temporary chats are unchanged. Unavailable
recall does not fail the conversation. Source reflection can form grounded memories from completed turns. Its queue is best effort and in memory, not a durable scheduled job. Reflection uses the same local Dstar background slot, never an additional model.

## Port limits and background formation

Archive tools reject inputs over 64 MiB, individual expanded entries over 10 MiB,
and ZIP declared totals over 100 MiB before extraction. Office ZIP containers
receive the same preflight check. Larger files require an explicit design change.
Watches use 500 ms polling after an initial readiness scan to avoid the shared
macOS native watcher limit; symlinks are not followed.

`personal_memory_lifecycle` and `personal_task_delivery` are internal host endpoints,
excluded from model discovery. Reflection sees only the latest user text and
visible answer, not private reasoning. Source grounding checks reject invented
names. Formation does not replace context summaries, and does not change old
per-turn memory snapshots or the stable system prefix.

## Optional memory features

Personal tools → Semantic memory settings controls the local embedding endpoint,
model and dimensions, reference-query rewriting, and idle consolidation. Defaults
are off. No remote account or model is activated by installation.
`personal_semantic_memory` offers status/search and an explicit 100-note indexing
pass. Ranking falls back to keywords on embedding failure. Consolidation retains
archived source notes; recent Chat context and conversation archives are unchanged.
