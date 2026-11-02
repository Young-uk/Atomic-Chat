import { ConfigValidationError } from "./config-validation-error.mjs";
import { parseNonEmptyString } from "./config-primitives.mjs";
function parseStringArrayOrNull(raw, field) {
  if (raw === null || raw === void 0) return null;
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected string[] or null, got ${JSON.stringify(raw)}`
    );
  }
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected non-empty string, got ${JSON.stringify(entry)}`
      );
    }
    result.push(entry);
  }
  return result;
}
function parseUrl(raw, field) {
  const str = parseNonEmptyString(raw, field);
  try {
    new URL(str);
    return str;
  } catch {
    throw new ConfigValidationError(
      field,
      `expected valid URL, got ${JSON.stringify(raw)}`
    );
  }
}
function parseNullableString(raw, field) {
  if (raw === void 0 || raw === null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  throw new ConfigValidationError(
    field,
    `expected string or null, got ${JSON.stringify(raw)}`
  );
}
export {
  parseNullableString,
  parseStringArrayOrNull,
  parseUrl
};
