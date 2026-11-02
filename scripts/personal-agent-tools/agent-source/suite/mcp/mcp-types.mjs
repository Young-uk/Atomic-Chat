const MCP_SERVER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const MCP_SERVER_NAME_MAX_LENGTH = 32;
const MCP_TOOL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export {
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_NAME_RE,
  MCP_TOOL_NAME_RE
};
