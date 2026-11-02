import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseBool, parseNonEmptyString } from "./config-primitives.mjs";
import { parseStringArrayOrNull, parseUrl } from "./config-values.mjs";
import {
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_NAME_RE
} from "../mcp/mcp-types.mjs";
function parseMcpTrustLevel(raw, field) {
  if (raw === "approval_gated" || raw === "pure_read") return raw;
  throw new ConfigValidationError(
    field,
    `expected one of approval_gated|pure_read, got ${JSON.stringify(raw)}`
  );
}
function parseMcpEnv(raw, field) {
  if (raw === null || raw === void 0) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      throw new ConfigValidationError(
        `${field}.${k}`,
        "env var name must match [A-Za-z_][A-Za-z0-9_]*"
      );
    }
    if (typeof v !== "string") {
      throw new ConfigValidationError(
        `${field}.${k}`,
        "env value must be a string"
      );
    }
    out[k] = v;
  }
  return out;
}
const HTTP_HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
function parseMcpHeaders(raw, field) {
  if (raw === null || raw === void 0) return void 0;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!HTTP_HEADER_NAME_RE.test(k)) {
      throw new ConfigValidationError(
        `${field}.${k}`,
        "http header name must be a valid RFC 7230 token"
      );
    }
    if (typeof v !== "string") {
      throw new ConfigValidationError(
        `${field}.${k}`,
        "http header value must be a string"
      );
    }
    out[k] = v;
  }
  return out;
}
function parseMcpTransport(raw, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected transport object");
  }
  const obj = raw;
  if (obj.kind === "stdio") {
    const command = parseNonEmptyString(obj.command, `${field}.command`);
    const args = obj.args === void 0 ? void 0 : parseStringArrayOrNull(obj.args, `${field}.args`);
    const cwd = obj.cwd === void 0 || obj.cwd === null ? void 0 : parseNonEmptyString(obj.cwd, `${field}.cwd`);
    return {
      kind: "stdio",
      command,
      ...args ? { args } : {},
      ...cwd ? { cwd } : {}
    };
  }
  if (obj.kind === "streamable_http") {
    const url = parseUrl(obj.url, `${field}.url`);
    const headers = obj.headers === void 0 || obj.headers === null ? void 0 : parseMcpHeaders(obj.headers, `${field}.headers`);
    return {
      kind: "streamable_http",
      url,
      ...headers ? { headers } : {}
    };
  }
  if (obj.kind === "sse") {
    const url = parseUrl(obj.url, `${field}.url`);
    const headers = obj.headers === void 0 || obj.headers === null ? void 0 : parseMcpHeaders(obj.headers, `${field}.headers`);
    return {
      kind: "sse",
      url,
      ...headers ? { headers } : {}
    };
  }
  throw new ConfigValidationError(
    `${field}.kind`,
    `expected stdio|streamable_http|sse, got ${JSON.stringify(obj.kind)}`
  );
}
function parseMcpServers(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected array, got ${JSON.stringify(raw)}`
    );
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected object, got ${JSON.stringify(entry)}`
      );
    }
    const cfg = entry;
    const name = parseNonEmptyString(cfg.name, `${field}[${i}].name`);
    if (name.length > MCP_SERVER_NAME_MAX_LENGTH) {
      throw new ConfigValidationError(
        `${field}[${i}].name`,
        `name exceeds ${MCP_SERVER_NAME_MAX_LENGTH} chars`
      );
    }
    if (!MCP_SERVER_NAME_RE.test(name)) {
      throw new ConfigValidationError(
        `${field}[${i}].name`,
        `name must match ${MCP_SERVER_NAME_RE.source}`
      );
    }
    if (seen.has(name)) {
      throw new ConfigValidationError(
        `${field}[${i}].name`,
        `duplicate server name ${JSON.stringify(name)}`
      );
    }
    seen.add(name);
    const enabled = parseBool(
      cfg.enabled === void 0 ? true : cfg.enabled,
      `${field}[${i}].enabled`
    );
    const description = cfg.description === void 0 || cfg.description === null ? void 0 : parseNonEmptyString(cfg.description, `${field}[${i}].description`);
    const transport = parseMcpTransport(
      cfg.transport,
      `${field}[${i}].transport`
    );
    const trust = cfg.trust === void 0 || cfg.trust === null ? void 0 : parseMcpTrustLevel(cfg.trust, `${field}[${i}].trust`);
    const env = cfg.env === void 0 || cfg.env === null ? void 0 : parseMcpEnv(cfg.env, `${field}[${i}].env`);
    const enabledTools = parseStringArrayOrNull(
      cfg.enabledTools,
      `${field}[${i}].enabledTools`
    );
    const disabledTools = parseStringArrayOrNull(
      cfg.disabledTools,
      `${field}[${i}].disabledTools`
    );
    out.push({
      name,
      enabled,
      transport,
      ...description ? { description } : {},
      ...trust ? { trust } : {},
      ...env ? { env } : {},
      ...enabledTools ? { enabledTools } : {},
      ...disabledTools ? { disabledTools } : {}
    });
  }
  return out;
}
export {
  parseMcpServers
};
