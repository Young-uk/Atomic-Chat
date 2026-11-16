# Preserve foreground usage identity during streaming

The transport seeds measured foreground usage with the verified model and server scopes. The local SSE observer previously omitted both scopes, overwriting the measured record with unscoped counts. The context control correctly rejected those counts and displayed the previous completed request, even after compaction reduced the prompt.

Pass the seeded scopes to the SSE observer only when its serialized model matches. Publish the measured compacted envelope before inference so occupancy updates without waiting for completion. Keep strict scope checks and the independently labeled completed-request cache statistics.

Regression verification covers the affected 129,838 to 87,422-token transition, progress byte preservation, and refusal to inherit another model's identity. No generation, cache layout, summary prompt or server configuration changes.
