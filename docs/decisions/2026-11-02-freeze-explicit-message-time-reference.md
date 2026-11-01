---
date: 2026-11-02
title: "Freeze explicit time references on newly sent messages"
---

# 2026-11-02 — Freeze explicit time references on newly sent messages

- **Context:** A model combined a prior message's 11:24 time with the latest message's November 2 date. Persisted user clocks were chronological and agreed with creation timestamps. Bare Date/Time prefixes did not clearly separate current-request time from historical message and search publication times.
- **Decision:** New opt-in message clocks use version 2, capturing local date/time according to existing options plus IANA timezone and numeric UTC offset at send time. Their model-only prefix states that the latest user timestamp is the request reference, older timestamps are historical, and web publication times are source dates. Never combine clock fields from different messages. This is a frozen send timestamp, not a live tool-execution clock.
- **Compatibility:** Unversioned historical clocks retain their exact previous wire representation. Newly versioned prefixes remain identical on reload, tool continuation and subsequent user turns. The UI/copy/edit text and visible clock labels are unchanged. No dynamic system-prefix rewrite and no historical metadata migration.
- **Consequences:** More explicit guidance can reduce time confusion but cannot guarantee a model follows it. A time-disabled option does not inject a time; date-disabled does not inject a date. Scheduled text-task clocks are a separate path and are not changed here. Summary replacement still requires a first prefill because old token inputs were removed; subsequent reuse is a separate runtime check.
- **Owner:** personal fork.
- **Validation:** Focused message-clock, deferred-send and transport tests cover legacy bytes, new timezone/reference text, midnight/reload stability, attachments and native-agent replay. Full gate and deployed-app results are recorded separately.
