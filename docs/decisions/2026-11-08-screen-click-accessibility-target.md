# Resolve screenshot click ownership using Accessibility hit testing

A CGWindow bounding rectangle can belong to the Dock even over visually transparent space. The previous code picked that rectangle's owner and then tried to activate the Dock, failing with not-frontmost despite Chrome being frontmost.

Use system-wide Accessibility element hit testing and its owning PID first. If AX cannot resolve the target, preserve conservative window-list fallback while refusing ambiguous Dock rectangles. An actual Dock target returns dock-target with recapture guidance before any activation. Protected-app checks, browser-sensitive target approval, current target revalidation and screenshot geometry remain in place; no click-through or force-click fallback is introduced.

CPU fixtures cover an AX Chrome hit under a Dock rectangle, actual Dock ownership, and missing AX evidence. Installed real-page clicking remains distinct from these tests.
