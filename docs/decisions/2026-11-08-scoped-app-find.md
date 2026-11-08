# Scoped app-owned Find

Date: 2026-11-08

## Decision

Own Command+F (Control+F outside macOS) in the webview instead of relying on
browser Find. Keep Command+K as cross-conversation search. Capture only the
platform Find/Find Next shortcuts, never active IME composition. Enter and
Shift+Enter navigate results; Command+G and Shift+Command+G do the same on macOS.
Escape closes Find and restores the previous focus without editing text.

Search the focused multiline editor, open modal/popover/menu, or focused
navigation/page. The chat composer belongs to the conversation scope. Mount
Find inside an active Radix layer so its focus trap, menu typeahead and outside
click handling do not close or steal focus from Find. A sticky first-child
mount keeps controls visible in scrollable layers; narrow menus wrap controls.

DOM search joins inline text, selects ranges and scrolls matches into view.
Textarea search reads current values, retains UTF-16 offsets and uses an inert
measurement mirror to reveal wrapped offscreen lines without changing text.
An exact-match excerpt remains visible while the Find input owns focus.

Conversations register complete loaded message data independently of rendered
markdown. Search text, reasoning and selected user-readable tool-output fields;
show the source type and exact excerpt, and navigate to the message anchor.
Explicit rendered-text markers keep ordinary prose matching independent of
Markdown source syntax.
API activity registers the filtered/sorted loaded rows and reveals virtualized
rows with the existing virtualizer. Other page controls remain DOM searchable.
Observers refresh changed text and input values, discard disconnected/obscured
scopes and exclude Find's own UI and measurement mutations.

## Boundaries

This is current-view search, not global database search. It does not fetch older
API pages, open other screens, index attachments, or search native OS menus.
Password/hidden inputs, hidden DOM, scripts and opaque metadata are excluded.
Arbitrary tool input/JSON properties and binary payloads are not indexed.
Collapsed source matches are explicitly labelled excerpt previews; Find does
not execute actions or pretend a collapsed tool body was expanded/highlighted.
Normal message text blocks explicitly mark their rendered bodies. The visible
DOM is authoritative for a mounted, searchable body, so links, emphasis and
repeated text use their actual displayed occurrence counts. Raw prose source
is a fallback only for a missing/unrendered body. Reasoning/tool source remains
independent. Case-insensitive literal matching does not normalize Unicode or
parse regex.

## Validation

Model-free unit tests cover textarea values and focus restoration, modal/menu
isolation, native macOS conventions, IME, DOM mutations, inline text, secrets,
conversation source and virtual API rows. Chromium layout tests cover Medium
and Extra Large text, light/dark themes, 1024/1280 windows, long wrapped editor
values, scrolling dialogs and narrow menus. No installed application, model
engine or actual conversation is needed for these checks.
