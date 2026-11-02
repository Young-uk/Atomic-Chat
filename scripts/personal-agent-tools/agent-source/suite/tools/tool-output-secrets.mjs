import {
  maskSecrets
} from "../error-reporting/secret-detector.mjs";
const UNMASKED_TOOLS = /* @__PURE__ */ new Set(["reply", "finish"]);
const PROMPT_DETAIL_FIELDS = [
  ["worldSnapshot", "text"],
  ["skillLoaded", "body"]
];
function maskPromptDetails(details, known) {
  if (details === null || typeof details !== "object") return details;
  let out = details;
  for (const [field, key] of PROMPT_DETAIL_FIELDS) {
    const holder = details[field];
    if (holder === null || typeof holder !== "object") continue;
    const text = holder[key];
    if (typeof text !== "string") continue;
    const masked = maskSecrets(text, known);
    if (masked === text) continue;
    if (out === details) out = { ...details };
    out[field] = { ...holder, [key]: masked };
  }
  return out;
}
function maskResultSecrets(result, known = []) {
  const summary = maskSecrets(result.summary, known);
  const full = result.fullOutput === void 0 ? void 0 : maskSecrets(result.fullOutput, known);
  const details = maskPromptDetails(result.details, known);
  if (summary === result.summary && full === result.fullOutput && details === result.details) {
    return result;
  }
  const masked = { ...result, summary, details };
  if (full !== void 0) {
    Object.defineProperty(masked, "fullOutput", { value: full, enumerable: false });
    Object.defineProperty(masked, "fullOutputTruncated", {
      value: result.fullOutputTruncated,
      enumerable: false
    });
  }
  return masked;
}
function maskErrorSecrets(err, known = []) {
  if (err instanceof Error) {
    const message = maskSecrets(err.message, known);
    if (message !== err.message) {
      try {
        err.message = message;
      } catch {
      }
    }
    return err;
  }
  let text;
  try {
    text = String(err);
  } catch {
    return err;
  }
  const masked = maskSecrets(text, known);
  return masked === text ? err : new Error(masked);
}
export {
  UNMASKED_TOOLS,
  maskErrorSecrets,
  maskResultSecrets
};
