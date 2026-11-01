# Personal Chat agent capabilities through a bounded MCP worker

## Decision

Keep Personal Chat's existing transport, Dstar cache identity, summary/archive
and approval pipeline. Do not embed the standalone Agent inference loop. Add a
local Node MCP worker with five tools: browser, explicit cross-chat memory,
scheduled text tasks, macOS window control and bounded workspace change watches. Pin playwright-core 1.59.1 and use
installed Chrome in a dedicated profile, without downloading a browser.

Memory is explicit, provenance-bearing data. Search results do not become new
instructions and are not automatically prepended to every prompt. Existing
conversation archives and unresolved-work ledgers remain authoritative in Chat;
this store is an additional user-managed cross-chat notebook, not a replacement.

Tasks persist one-shot or interval schedules and their results. While the worker
is connected, they use Dstar's low-priority summary slot, without tools or external
side effects. On startup, overdue/interrupted work becomes missed rather than
replaying a backlog. Cancellation survives completion races. Scheduling arbitrary
unattended browser/shell actions is deliberately not granted by a text task.

Browser actions require a preceding read and current element references. Only
dedicated profile tabs are exposed. Private network navigation and secret input
are blocked; downloads are disabled. Pages are untrusted evidence. Window actions
are bounded list/focus/move/resize/minimize operations using JSON argv and macOS
Accessibility permission, not interpolated executable code.

Personal tools follow Chat's explicit Full access/manual choice rather than the
global MCP auto-approval toggle. A user-operated Connectors panel exposes memory
search/deletion and task status/results/cancellation. Installation merges only our
connector, backs up configuration and leaves it disabled until enabled in Chat.

## Scope and limits

This is a Personal macOS implementation. No OS launch agent is installed: tasks
do not run while Chat is closed or the Mac is asleep. Automatic missed-task
catch-up, unattended action workflows, semantic embeddings and general arbitrary
computer input are not implied. Existing shell, skills, MCP, archive and search
capabilities remain available through their existing controls.

## Validation

Run the Node regression suite, frontend approval and panel tests, repository
verification, then actual MCP handshake, browser read/action and installed Chat
checks. A passing build is not deployed-app evidence. Never test by modifying
existing conversations or model files.

Workspace watches report bounded file-name events only, require canonical paths
inside the configured workspace, and stop with the worker. They do not read file
contents or launch tasks automatically.
