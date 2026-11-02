import { getDefaultArgsJsonSchema } from "../prompt/default-tool-args-schemas.mjs";
import { canonicalArgs } from "./argument-aliases.mjs";
const NEAREST_KEY_MAX_DISTANCE = 2;
const ARGUMENT_ERROR_WORDING = /`[^`]+`|\bmust be\b|\bis required\b|\brequired\b|\bprovide (?:either|a|an|the|one)\b|\bmissing\b|\bunknown (?:arg|argument|field|key|option)\b|\bnot allowed\b/i;
function describeArgumentError(input) {
  if (!ARGUMENT_ERROR_WORDING.test(input.message)) return null;
  const args = canonicalArgs(input.tool, input.args);
  const receivedKeys = Object.keys(args);
  const expectedKeys = expectedKeysFor(input.tool);
  const expectedSet = new Set(expectedKeys);
  if (expectedKeys.length > 0 && receivedKeys.every((key) => expectedSet.has(key)) && requiredKeysFor(input.tool).every((key) => args[key] !== void 0)) {
    return null;
  }
  const nearest = [];
  for (const received of receivedKeys) {
    if (expectedSet.has(received)) continue;
    const match = nearestKey(received, expectedKeys);
    if (match !== null) nearest.push({ received, expected: match });
  }
  const parts = [
    `received keys: ${receivedKeys.length > 0 ? receivedKeys.join(", ") : "(none)"}`
  ];
  if (expectedKeys.length > 0) parts.push(`expected: ${expectedKeys.join(", ")}`);
  for (const { received, expected } of nearest) {
    parts.push(`did you mean \`${expected}\` instead of \`${received}\`?`);
  }
  return {
    message: `${input.message} \u2014 ${parts.join("; ")}`,
    receivedKeys,
    expectedKeys,
    nearest
  };
}
function expectedKeysFor(tool) {
  const schema = getDefaultArgsJsonSchema(tool);
  const properties = schema?.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties);
}
function requiredKeysFor(tool) {
  const required = getDefaultArgsJsonSchema(tool)?.required;
  return Array.isArray(required) ? required.filter((key) => typeof key === "string") : [];
}
function nearestKey(received, expected) {
  let best = null;
  const needle = received.toLowerCase();
  for (const key of expected) {
    const distance = editDistance(needle, key.toLowerCase());
    if (distance > NEAREST_KEY_MAX_DISTANCE) continue;
    if (best === null || distance < best.distance) best = { key, distance };
  }
  return best?.key ?? null;
}
function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(
        Math.min(previous[j] + 1, current[j - 1] + 1, substitution)
      );
    }
    previous = current;
  }
  return previous[b.length];
}
export {
  NEAREST_KEY_MAX_DISTANCE,
  describeArgumentError,
  nearestKey
};
