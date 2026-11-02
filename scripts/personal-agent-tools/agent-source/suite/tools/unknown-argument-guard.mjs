import { getDefaultArgsJsonSchema } from "../prompt/default-tool-args-schemas.mjs";
import { canonicalArgs } from "./argument-aliases.mjs";
import { nearestKey } from "./argument-error-hint.mjs";
import { normalizeArgKeys } from "./coerce-tool-args.mjs";
function findUnknownArguments(tool, args) {
  const properties = schemaProperties(tool);
  if (properties === null) return null;
  const expectedKeys = Object.keys(properties);
  const canonical = canonicalArgs(tool, args);
  const unknownKeys = Object.keys(normalizeArgKeys(canonical, properties)).filter(
    (key) => !Object.hasOwn(properties, key)
  );
  if (unknownKeys.length === 0) return null;
  const nearest = [];
  const unsuggested = [];
  for (const received of unknownKeys) {
    const expected = suggestKey(received, expectedKeys);
    if (expected !== null) nearest.push({ received, expected });
    else unsuggested.push(received);
  }
  const hint = tool === "os.shell.run" ? shellScriptHint(args, unsuggested) : null;
  return {
    message: describeUnknownArguments({
      tool,
      unknownKeys,
      expectedKeys,
      nearest,
      hint
    }),
    unknownKeys,
    expectedKeys,
    nearest
  };
}
function suggestKey(received, expected) {
  const stripped = received.replace(/^[-_]+/, "");
  if (stripped.length > 0 && stripped !== received) {
    const needle = stripped.toLowerCase();
    const exact = expected.find((key) => key.toLowerCase() === needle);
    if (exact !== void 0) return exact;
  }
  return nearestKey(received, expected);
}
const SCRIPT_FLAG_BY_INTERPRETER = /* @__PURE__ */ new Map([
  ["node", "-e"],
  ["nodejs", "-e"],
  ["perl", "-e"],
  ["ruby", "-e"]
]);
function shellScriptHint(args, unsuggested) {
  if (!unsuggested.some((key) => key.startsWith("-"))) return null;
  const cmd = typeof args.cmd === "string" ? args.cmd.trim() : "";
  const interpreter = (cmd.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/[\d.]+$/, "");
  const flag = SCRIPT_FLAG_BY_INTERPRETER.get(interpreter) ?? "-c";
  return `put the script in args: ["${flag}", "\u2026"]`;
}
function describeUnknownArguments(input) {
  const { tool, unknownKeys, expectedKeys, nearest, hint } = input;
  const listed = unknownKeys.map((key) => `\`${key}\``).join(", ");
  const head = `unknown argument${unknownKeys.length > 1 ? "s" : ""} ${listed} for ${tool}`;
  const parts = [
    `expected: ${expectedKeys.length > 0 ? expectedKeys.join(", ") : "(no arguments)"}`
  ];
  for (const { received, expected } of nearest) {
    parts.push(
      unknownKeys.length === 1 ? `did you mean \`${expected}\`?` : `did you mean \`${expected}\` instead of \`${received}\`?`
    );
  }
  if (hint !== null) parts.push(hint);
  return `${head} (${parts.join("; ")}) \u2014 the call was not run; re-emit it with the right keys`;
}
function schemaProperties(tool) {
  const schema = getDefaultArgsJsonSchema(tool);
  if (schema === void 0 || schema.additionalProperties !== false) {
    return null;
  }
  const properties = schema.properties;
  return properties !== null && typeof properties === "object" && !Array.isArray(properties) ? properties : null;
}
export {
  findUnknownArguments,
  suggestKey
};
