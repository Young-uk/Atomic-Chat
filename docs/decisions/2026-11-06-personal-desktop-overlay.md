# Personal desktop control activity overlay

The Personal macOS build shows recent assistant text while a desktop tool turn
is active and the chat window is in the background. The dedicated webview is
non-focusable and ignores pointer events so the target application keeps control.
It receives plain display text without tool arguments or reasoning. Decisions
on pending actions remain in the main window. The chat route hides the card on
completion or navigation and stops publishing while the main window has focus.
