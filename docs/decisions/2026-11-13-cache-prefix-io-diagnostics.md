# Cache-prefix and expert I/O diagnostics

## Decision

Enable hash-only prompt tracing and sampled Metal expert I/O counters in the personal Strata policy. Retain the model, arithmetic, KV layout, 4096-row chunk, memory limits, scheduler weights, parallel configuration and MTP-off setting.

The server captures tools, effective template options, historical messages and the rendered input prefix as hashes. It compares only when a foreground request actually starts; summary requests never replace the foreground trace. A completed request logs fixed change labels, message indexes and native reuse counts. It stores no dialogue text in this diagnostic. Optional trace metadata is authenticated against the saved native checkpoint before reuse across restarts. It does not authorize a cache clone or replace a semantic history receipt. The trace module is included in the backend qualification hash.

Metal records expert-wait wall time, host callback wall time, completed read bytes/experts and overlapping I/O-worker time. Foreground and summary banks have separate aggregates. Prompt chunks log once each, window counters log first/every 100 windows. GPU command span includes host turns; worker time can exceed wall time and completed read-ahead may cross window boundaries. These numbers must not be summed as exclusive GPU compute time.

## Compatibility and validation

Only the exact previously qualified 128K original-IQ4 cache identity receives a reviewed update bridge. Native checkpoint validation and all admission checks remain intact. Stage immutable engine/runtime paths, run Python HTTP/cache/qualification regressions, native CPU/GPU tests and the personal app gates. Use an isolated real-model fixture to check trace classification, cache restoration, summary isolation, output equality and diagnostic overhead before installation.

The runtime is copied from the verified v92 baseline with only the reviewed server, disk-session, trace module and qualification file-list changes. Other repository/runtime differences are not silently deployed.
