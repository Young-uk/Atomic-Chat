# Approve a pending desktop action from the activity overlay

The overlay displays the same current permission request parameters as the main dialog and offers Allow once and Deny. It remains visible while awaiting approval even if the main window has focus, and accepts mouse clicks without activating the app or stealing the target browser focus. It never grants persistent permissions.

A native command accepts decisions only from the overlay window and relays an opaque per-request token. The chat validates the token and exact current modal identity and consumes it before calling existing approval callbacks. Changed, closed and already-resolved requests cannot reuse a prior decision. The worker confirmation and OS permissions remain unchanged. The overlay uses textContent for request data and bounds scrolling inside the card.

OS-level permission prompts are not approved by this overlay; their system dialogs remain authoritative.
