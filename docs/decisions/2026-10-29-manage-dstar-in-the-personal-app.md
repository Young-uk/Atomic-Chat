---
date: 2026-10-29
title: "Manage the installed Dstar engine in the personal app"
---

# 2026-10-29 — Manage the installed Dstar engine in the personal app

- **Context:** The personal app already has an OpenAI-compatible Dstar endpoint on loopback port 8010, but starting the engine requires an external launcher. A saved Connected label can outlive the process. The installed Qwen directory also contains old range maps without their payloads.
- **Decision:** Add a personal-fork control panel to Server → Engine & model and Custom Endpoint. Custom Endpoint nests the controls under the associated endpoint card in a collapsed Server controls section; Server → Engine & model keeps the standalone panel. A native channel actor owns one child process group and serializes start/stop/status. Keep the existing provider transport and model capabilities. The renderer supplies only a validated installed quantization and context size; it cannot supply executable paths, commands, hosts, or extra arguments.
- **Defaults:** Preserve IQ3_XXS, 65,536 tokens, loopback-only binding, the existing IQ3 KV directory, and its 2 GiB disk cap. Selection changes are drafts until explicit start or confirmed restart. Show the actual active selection separately. Do not elevate GPU memory limits, download models, or move/delete payloads.
- **Ownership:** Closing the window keeps the engine running. Full app exit stops only the process group started by this app. An externally started server or occupied port is reported without taking ownership, trusting stale PID files, or killing that process.
- **Readiness:** Probe the live model-list endpoint; a spawned process alone is Loading. Process exit reports an error with bounded local log output. A range map counts only when its completed prefix/ranges cover the entire GGUF payload. Incomplete or missing quantizations are visible but cannot be started.
- **Consequences:** Existing Dstar binaries and Metal resources remain installed under the user's Application Support directory. This does not add runtime dependencies or redesign core provider/inference behavior. Initial physical-model choices cover the launcher's Flash-Next q2/iq3/iq3s variants; its advertised chat aliases remain selectable through the existing provider. Other model families and automatic installation are outside this change.
- **Owner:** personal fork.
- **Links:** `src-tauri/src/core/dstar.rs`, `web-app/src/containers/server/DstarControlPanel.tsx`, `web-app/src/services/dstar.ts`.
