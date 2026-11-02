import { ConfigValidationError } from "./config-validation-error.mjs";
function parseSessionRailConfig(raw) {
  if (raw === void 0 || raw === null) return { order: [], pinned: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "tui.sessionRail",
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const block = raw;
  return {
    order: parseSessionIdList(block.order, "tui.sessionRail.order"),
    pinned: parseSessionIdList(block.pinned, "tui.sessionRail.pinned")
  };
}
function parseSessionIdList(raw, path) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      path,
      `expected string[], got ${JSON.stringify(raw)}`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
export {
  parseSessionRailConfig
};
