# Manage persistent Chat tool permissions

The user requested an Always allow choice and a settings view for granting and
revoking it. Keep the existing once/thread scopes and Full access mode.

Persist tool grants with a SHA-256 identity containing the provider name,
connection configuration and input schema. Configuration values (including
credentials) are hashed, never copied into the approval store. Unknown or
ambiguous names cannot acquire persistent grants. Recheck the identity after
approval in case the connection changed while its dialog was open. Built-in
command/script grants explicitly cover that tool across conversations; they do
not alter the backend workspace constraints or tool enablement checks.

General settings lists live tools and disconnected saved grants. Revocation
also removes the same tool's remembered thread grants. Full access remains an
independent auto-approval policy, clearly stated in the settings description.
Native pending proposals keep fresh, immutable-action confirmation, even with
remembered access or Full access; their dialog offers only one-time approval.
Storage version 2 preserves the user's existing global switch rather than
repeating the historical version-1 reset.

The reported screenshot contains advice about possible tests, not an actual
tool call. No approval dialog was pending. Introduce a prospective v4 tool-policy
marker to distinguish advice from authorized execution and avoid claiming an
approval prompt exists before issuing a real call. Keep v1-v3 historical prompt
bytes unchanged. Completion-review diagnostics record only decision, turn id
and available-tool count, never private reasoning or tool arguments.

Validate persistence/revocation, provider and schema changes, Full access,
fresh proposals, disabled-tool enforcement, old/new prompt prefix stability,
and real-browser layout at supported sizes. Actual external-service activation
and permission grants are separate from implementing the UI.
