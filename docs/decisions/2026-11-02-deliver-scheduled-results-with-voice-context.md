---
date: 2026-11-02
title: "Deliver scheduled results through the app with captured assistant voice"
---

# Scheduled result delivery and voice

- **Context:** A reminder completed at 08:00 but remained only in worker state. The external osascript notification failure was discarded, and the independent model request did not receive the conversation's assistant instructions.
- **Decision:** Capture the actual originating thread and live assistant instructions when Chat creates a task. Store the instruction snapshot privately, without echoing it into tool results. Scheduled execution uses that snapshot with explicit text-only limits and execution time. Persist each completed result into an independent delivery outbox. An app-wide consumer writes a deterministic assistant message to the originating thread, verifies persistence, submits a notification through the application's notification permission/identity, and records success or failure. Notification failure retries delivery after at least one minute, never inference. Cancelled runs are not delivered. Old saved runs without outbox metadata are not silently replayed. Delivery bookkeeping is listed only for backend MCP routing and excluded from model tool schemas.
- **Consequences:** Result generation, conversation persistence and OS notification submission are separate observable states. An OS API success means submitted, not that Focus allowed the banner to appear. The app and its Personal connector must remain running. No unattended external tools or messages are enabled. Existing conversations, schedules and legacy results remain intact.
- **Owner:** @Young-uk.
