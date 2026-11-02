import {
  coerceJsonSchemaValue,
  validateJsonSchemaValue
} from "../llm/provider/openai/coerce-json-schema-value.mjs";
import { getDefaultArgsJsonSchema } from "../prompt/default-tool-args-schemas.mjs";
function coerceToolArgs(name, args) {
  const properties = argsProperties(name);
  if (!properties) return args;
  const normalised = normalizeArgKeys(args, properties);
  let coerced = null;
  for (const [key, value] of Object.entries(normalised)) {
    if (typeof value !== "string") continue;
    const schema = asSchema(properties[key]);
    if (!schema) continue;
    const candidate = tryCoerce(value, schema);
    if (candidate === void 0) continue;
    coerced ??= { ...normalised };
    coerced[key] = candidate;
  }
  return coerced ?? normalised;
}
function normalizeArgKeys(args, properties) {
  let fixed = null;
  for (const [key, value] of Object.entries(args)) {
    if (Object.hasOwn(properties, key)) continue;
    const clean = normalizeKey(key);
    if (clean === null || clean === key) continue;
    if (!Object.hasOwn(properties, clean) || Object.hasOwn(args, clean)) {
      continue;
    }
    fixed ??= { ...args };
    delete fixed[key];
    fixed[clean] = value;
  }
  return fixed ?? args;
}
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
function normalizeKey(key) {
  let clean = key.trim();
  const comma = clean.lastIndexOf(",");
  if (comma !== -1) clean = clean.slice(comma + 1).trim();
  clean = clean.replace(/<[^<>]*>/g, "").trim();
  clean = clean.replace(/^(?:\\?["'`])+|(?:\\?["'`])+$/g, "").trim();
  return IDENTIFIER.test(clean) ? clean : null;
}
function tryCoerce(value, schema) {
  try {
    if (validateJsonSchemaValue(value, schema)) return void 0;
    const candidate = coerceJsonSchemaValue(value, schema);
    return typeof candidate === "string" ? void 0 : candidate;
  } catch {
    return void 0;
  }
}
function argsProperties(name) {
  const schema = getDefaultArgsJsonSchema(name);
  return schema ? asSchema(schema.properties) : null;
}
function asSchema(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
export {
  coerceToolArgs,
  normalizeArgKeys,
  normalizeKey
};
