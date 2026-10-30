# Allow Dstar checkpoints to finish during shutdown

The previous controller killed the process group after five seconds, including
while Dstar was persisting a long-context KV checkpoint. Interrupted staging
can leave temporary payloads and force a cold prefill after restart.

Use the same bounded 120-second grace period for Stop and application exit;
the outer shutdown reply timeout is 125 seconds. Preserve ownership boundaries:
external servers remain untouched. This changes shutdown latency, not inference
or cache matching. Dstar logs staging attempts and underlying write errors.

A timeout remains a fallback, not proof that persistence completed. Long-context
restart recovery still requires sufficient disk space and a compatible cache key.
