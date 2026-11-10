# Confirmed shutdown of busy personal engines

Explicit Stop on the Dstar or Strata control panel stays available during active work. Busy frontend state, or a native engineBusy rejection, opens a confirmation dialog. Dismissing it has no lifecycle effect. Confirmation aborts chat/tool work, requests agent cancellation and pauses queued sends, preserving conversation history.

The dedicated stop_confirmed action bypasses inference/summary admission only. It requires the exact engine owned by the controller, checks competitors, captures descendant PID/start-time identities, cancels pending launches and requests graceful shutdown. After 15 seconds it terminates only captured processes whose identities still match. Stopped is published only after the launcher and captured descendants exit. Ordinary Stop and engine/context switching retain their existing admission barriers. Interrupted cache saving can require fresh prefill; originals remain intact.
