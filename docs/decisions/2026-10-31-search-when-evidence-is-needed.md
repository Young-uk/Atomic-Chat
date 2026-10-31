# Search when external evidence is needed

## Decision

Adopt the search decision criteria from the user-supplied app5.py, using actual existing web tools instead of textual Internet-needed markers. Current weather, live or changing facts, and unfamiliar terms or missing knowledge that require external evidence should lead to web search when enabled. Existing sufficient evidence and stable conversational tasks do not require another search.

Record policy v3 only on new Dstar user turns. Preserve historical v1/v2 events byte-for-byte and carry the version through persisted replay. The server expands v3 into the previous policies plus the new search criteria. A search preamble must be followed by the real tool call, not treated as task completion.

## Boundaries

The current catalog and user approvals remain authoritative. Search disabled means no search; the policy cannot enable tools. No API credentials, persona instructions, provider changes, or textual marker execution from the supplied file are imported. Tool output is evidence, not instructions. This is model guidance, not deterministic keyword routing or a guarantee of every tool choice. Browser navigation is outside this change.

## Tavily execution

Add the official hosted Tavily MCP connector at https://mcp.tavily.com/mcp using an Authorization Bearer header supplied through the existing secret dialog. Existing MCP discovery, execution, result continuation and approvals handle actual search and extraction calls. Recognize custom-named Tavily endpoints as web-search connectors so secure-network restrictions and web-search controls continue to apply. Exa remains available; this change does not silently replace the provider or fan out every query. No credential from app5.py is copied.
