import { ConfigValidationError } from "./config-validation-error.mjs";
function coerceIntLike(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  const value = coerceFloatLike(raw);
  if (!Number.isInteger(value)) return NaN;
  return Number.isSafeInteger(value) ? value : NaN;
}
function coerceFloatLike(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  const text = raw.trim();
  if (text.length === 0) return NaN;
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
}
function parsePositiveInt(raw, field) {
  const value = coerceIntLike(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ConfigValidationError(
      field,
      `expected positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function parseBoundedPositiveInt(raw, field, min, max) {
  const value = parsePositiveInt(raw, field);
  if (value < min || value > max) {
    throw new ConfigValidationError(
      field,
      `expected integer in [${min}, ${max}], got ${value}`
    );
  }
  return value;
}
function parseNonNegativeInt(raw, field) {
  const value = coerceIntLike(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new ConfigValidationError(
      field,
      `expected non-negative integer, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function parseNonNegativeBoundedInt(raw, field, min, max) {
  const value = parseNonNegativeInt(raw, field);
  if (value < min || value > max) {
    throw new ConfigValidationError(
      field,
      `expected integer in [${min}, ${max}], got ${value}`
    );
  }
  return value;
}
function parseUnitInterval(raw, field) {
  const value = coerceFloatLike(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigValidationError(
      field,
      `expected number in [0, 1], got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function parseHalfOpenUnitInterval(raw, field) {
  const value = coerceFloatLike(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new ConfigValidationError(
      field,
      `expected number in (0, 1], got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function parseBool(raw, field) {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const lc = raw.toLowerCase();
    if (["1", "true", "yes", "on"].includes(lc)) return true;
    if (["0", "false", "no", "off"].includes(lc)) return false;
  }
  throw new ConfigValidationError(
    field,
    `expected boolean, got ${JSON.stringify(raw)}`
  );
}
function parseBoolOrNull(raw, field) {
  if (raw === null || raw === void 0) return null;
  return parseBool(raw, field);
}
function parseNonEmptyString(raw, field) {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new ConfigValidationError(
    field,
    `expected non-empty string, got ${JSON.stringify(raw)}`
  );
}
let configNoticeSink = null;
function setConfigNoticeSink(sink) {
  configNoticeSink = sink;
}
const noticesSaid = /* @__PURE__ */ new Set();
function emitConfigNoticeOnce(line) {
  if (noticesSaid.has(line)) return;
  noticesSaid.add(line);
  emitConfigNotice(line);
}
function emitConfigNotice(line) {
  if (configNoticeSink) {
    configNoticeSink(line);
    return;
  }
  process.stderr.write(`${line}
`);
}
export {
  coerceFloatLike,
  coerceIntLike,
  emitConfigNotice,
  emitConfigNoticeOnce,
  parseBool,
  parseBoolOrNull,
  parseBoundedPositiveInt,
  parseHalfOpenUnitInterval,
  parseNonEmptyString,
  parseNonNegativeBoundedInt,
  parseNonNegativeInt,
  parsePositiveInt,
  parseUnitInterval,
  setConfigNoticeSink
};
