---
date: 2026-11-08
title: "Reveal and color the actual Find occurrence"
---

# 2026-11-08 — Reveal and color the actual Find occurrence

- **Context:** The app-owned Find preview could count a hit without visibly marking its location. Unsupported Custom Highlight webviews had no fallback, native editor selection disappeared when the query retained focus, and scrolling a long paragraph or virtual row did not reveal the matched line.
- **Decision:** Keep literal matching and current-view boundaries, but expose exact target resolvers. Center the target rectangle through nested scroll containers. Paint current and other matches with CSS Custom Highlights, using clipped, pointer-inert rectangles for older webviews and native editors. Do not rewrite React text or replace document Selection.
- **Consequences:** Find retains query focus and preserves drafts, menus and form actions. Source-backed reasoning/tool matches may open only explicitly registered disclosures, never click controls. Virtual lists reveal by identity before resolving current DOM fields; API preview truncation is temporarily removed. Pending reveals, overlays and highlights are cancelled on navigation, query changes and close. Already opened disclosures remain open for reading. Conversation messages currently render without virtualization; an optional identity reveal callback supports a future virtualized owner.
- **Validation:** Model-free unit tests exercise exact occurrences, fallback painting, cleanup, disclosure targets and virtual rows. Real-browser tests measure long-paragraph and editor hit visibility alongside existing modal/menu, font-size, theme and narrow-window coverage.
- **Owner:** team.
- **Links:** `web-app/src/lib/find-highlight.ts`, `web-app/src/lib/find-reveal.ts`, `web-app/src/components/FindInPage.tsx`.

Supersedes the excerpt-only collapsed-result behavior in [Scoped app-owned Find](2026-11-08-scoped-app-find.md). Search scope and data-exclusion rules remain unchanged.
