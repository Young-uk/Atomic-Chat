# Tavily search budgets and rate limiting

Personal Chat starts unspecified Tavily searches with fast depth and five results. Explicit advanced searches remain available when initial evidence is insufficient. Research is described as an explicit in-depth investigation, not a rate-limit fallback.

The desktop MCP service shares a Tavily cooldown across endpoints. Structured 429 responses honor Retry-After when exposed by MCP; missing metadata uses a 60-second fallback. Calls during cooldown fail locally with guidance to use an available alternative provider. Identical in-flight calls are rejected rather than sharing cancellation ownership. No completed-result cache or automatic billable retry is introduced.

Remote MCP may hide HTTP response headers. This policy cannot diagnose account-wide usage or guarantee upstream quota availability. It does not change server-side Agent IPC calls.
