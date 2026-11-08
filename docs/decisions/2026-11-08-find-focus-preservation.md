# Preserve query focus when revealing Find matches

Date: 2026-11-08

## Evidence

Installed WKWebView verification found that adding a DOM Selection range while
Find had keyboard focus moved focus to the matched page text. Typing Language
therefore stopped at the first character. Bulk-value jsdom tests did not model
this native behavior.

## Decision

Never write to document Selection for Find. Use the feature-detected CSS Custom
Highlight API for the active DOM match. Older webviews keep the exact excerpt
and scroll navigation without a page highlight; do not emulate highlighting
by changing the user's selection or inserting markup into source content.

Clear only the named Find highlight on query/index/scope changes, close and
unmount. Keep existing user selections intact. Around synchronous reveal,
preserve the control and caret that already owned focus inside Find. Never
redirect focus back to Find after the user deliberately chooses another control.
Textarea match selection is allowed only while Find or that editor owns focus.
Navigation buttons return to the query without resetting its caret/selection.

## Checks

Use real browser keyboard events one character at a time and assert full query,
active element and caret after each character. Exercise native-highlight and
forced-fallback paths, Enter/Shift+Enter, navigation buttons, textarea values,
and Escape cleanup. Mock a native focus change to test synchronous restoration.
A Chromium pass does not replace the installed WKWebView verification required
before delivery. No installed Playwright WebKit binary was available locally.
