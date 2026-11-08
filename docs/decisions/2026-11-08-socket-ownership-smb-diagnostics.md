# Preserve socket ownership checks with an inaccessible SMB mount

macOS lsof returns valid socket PID records while warning that an unrelated SMB filesystem cannot be statted. Rejecting all stderr blocked managed engine readiness and retries.

Accept only the observed complete three-line SMB mount-table warning in socket-only queries, requiring a nonempty /Volumes path and hexadecimal device identity. Reject all unknown, truncated, non-UTF8 or mixed diagnostics. Existing exit-status validation, PID process-tree ownership, foreign listener rejection and retained Unix socket busy detection remain enforced. Do not suppress all diagnostics or alter the user's mount.

Regression coverage checks warning parsing and live owned/foreign TCP listeners and detached Unix sockets while the affected mount remains present. No model inference prompts are submitted.
