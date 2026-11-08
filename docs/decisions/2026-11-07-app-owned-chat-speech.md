---
date: 2026-11-07
title: "Keep chat speech alive across navigation"
---

# 2026-11-07 — Keep chat speech alive across navigation

- **Context:** The thread route owned both the speech toggle and its queue.
  Changing thread parameters or leaving the page aborted synthesis, stopped
  playback and could shut down audio.cpp during an active request.
- **Decision:** Keep the toggle, one serialized speech queue and per-Chat
  stream cursors in an app-owned store. Subscribe directly to the existing
  persistent Chat sessions, including while no thread page is mounted. Route
  components observe the same toggle and playback status. Explicit Off and
  application pagehide stop playback; navigation does not.
- **Consequences:** New replies from enabled sessions share one FIFO and never
  overlap. Loading finished history and returning to a conversation do not
  replay text. Off clears pending speech, and re-enabling waits for any late
  generation response/cancellation and transient-file cleanup. Failures stop
  the failed queue without changing the user's enabled choice; a later user
  turn can retry. The toggle lasts for this app session, not across restarts.
- **Verification:** Store tests cover background AI SDK streaming, navigation,
  explicit Off, fast off/on, failures and shutdown. Queue tests cover late
  requests, model preparation, FIFO playback and transient clip ownership.
  A Chromium test checks native WAV playback continues through chat/settings
  navigation and stops on Off. The audio.cpp shutdown lifetime fix is separate
  and must ship with the audio engine, not only the frontend.
- **Native validation:** The installed Personal app retains the enabled state
  across chats and settings, and the full audio engine drains cancellation
  without aborting. Native playback also exposed intermittent macOS
  `AudioDeviceStart` failures (`2003329396`), independently reproduced with a
  valid generated QA WAV in an isolated WKWebView without navigation or model
  inference. This limits end-to-end audio verification on that host. Playback
  failures now record media state and source kind in the application log, but
  no spoken text, file path or URL. Do not hide an output failure by extending
  the watchdog or treating an `onplaying` event alone as proof of progress.
- **Owner:** team.
- **Links:** `web-app/src/stores/chat-speech-store.ts`,
  `web-app/src/lib/audio/chat-speech-queue.ts`,
  `web-app/src/lib/audio/chat-speech-cursor.ts`.
