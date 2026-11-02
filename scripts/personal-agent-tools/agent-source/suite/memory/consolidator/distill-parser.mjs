import {
  LESSON_ACTIVATION_MAX_LENGTH,
  LESSON_PRINCIPLE_MAX_LENGTH,
  LESSON_MAX_TAGS,
  LESSON_TAG_MAX_LENGTH
} from "../lessons/lesson-store.mjs";
import {
  PROCEDURE_ACTIVATION_MAX_LENGTH,
  PROCEDURE_DESCRIPTION_MAX_LENGTH,
  PROCEDURE_TOOL_HINT_MAX_LENGTH,
  PROCEDURE_MIN_STEPS,
  PROCEDURE_MAX_STEPS,
  PROCEDURE_MAX_TAGS
} from "../procedures/procedure-store.mjs";
class DistillParseError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = "DistillParseError";
  }
}
const ACTIVATION_RE = /activation=\"([^\"]+)\"/;
const PRINCIPLE_RE = /principle=\"([^\"]+)\"/;
const TAGS_RE = /tags=([^"\n;]+)/;
const TAG_TOKEN_RE = /^[a-z][a-z0-9_\-]{0,39}$/;
const NONE_ACTIVATION = "(no consensus)";
const NONE_PRINCIPLE = "(no durable advice)";
function parseDistillOutput(raw) {
  const text = (raw ?? "").trim();
  if (text.length === 0) {
    throw new DistillParseError("no_lesson_line", "empty distill output");
  }
  if (text.startsWith("{")) {
    const fromJson = parseDistillJsonShape(text);
    if (fromJson) return fromJson;
  }
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("LESSON"));
  if (!line) {
    throw new DistillParseError(
      "no_lesson_line",
      "no LESSON line in distill output"
    );
  }
  const activationMatch = ACTIVATION_RE.exec(line);
  const principleMatch = PRINCIPLE_RE.exec(line);
  if (!activationMatch) {
    throw new DistillParseError(
      "missing_activation",
      "LESSON line missing activation"
    );
  }
  if (!principleMatch) {
    throw new DistillParseError(
      "missing_principle",
      "LESSON line missing principle"
    );
  }
  const activation = activationMatch[1].trim();
  const principle = principleMatch[1].trim();
  if (activation === NONE_ACTIVATION && principle === NONE_PRINCIPLE) {
    return { kind: "none" };
  }
  if (activation.length === 0) {
    throw new DistillParseError(
      "missing_activation",
      "activation must be non-empty"
    );
  }
  if (principle.length === 0) {
    throw new DistillParseError(
      "missing_principle",
      "principle must be non-empty"
    );
  }
  if (activation.length > LESSON_ACTIVATION_MAX_LENGTH) {
    throw new DistillParseError(
      "oversized_activation",
      `activation exceeds ${LESSON_ACTIVATION_MAX_LENGTH} chars`
    );
  }
  if (principle.length > LESSON_PRINCIPLE_MAX_LENGTH) {
    throw new DistillParseError(
      "oversized_principle",
      `principle exceeds ${LESSON_PRINCIPLE_MAX_LENGTH} chars`
    );
  }
  const tagsMatch = TAGS_RE.exec(line);
  const tags = tagsMatch ? parseTags(tagsMatch[1]) : [];
  return { kind: "lesson", activation, principle, tags };
}
function parseTags(raw) {
  const out = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > LESSON_TAG_MAX_LENGTH) continue;
    if (!TAG_TOKEN_RE.test(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= LESSON_MAX_TAGS) break;
  }
  return out;
}
function parseDistillJsonShape(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;
  const kindField = obj["kind"];
  if (kindField === "none") return { kind: "none" };
  if (kindField !== "lesson") return null;
  const activation = typeof obj["activation"] === "string" ? obj["activation"].trim() : "";
  const principle = typeof obj["principle"] === "string" ? obj["principle"].trim() : "";
  if (activation === NONE_ACTIVATION && principle === NONE_PRINCIPLE) {
    return { kind: "none" };
  }
  if (activation.length === 0) {
    throw new DistillParseError(
      "missing_activation",
      "activation must be non-empty"
    );
  }
  if (principle.length === 0) {
    throw new DistillParseError(
      "missing_principle",
      "principle must be non-empty"
    );
  }
  if (activation.length > LESSON_ACTIVATION_MAX_LENGTH) {
    throw new DistillParseError(
      "oversized_activation",
      `activation exceeds ${LESSON_ACTIVATION_MAX_LENGTH} chars`
    );
  }
  if (principle.length > LESSON_PRINCIPLE_MAX_LENGTH) {
    throw new DistillParseError(
      "oversized_principle",
      `principle exceeds ${LESSON_PRINCIPLE_MAX_LENGTH} chars`
    );
  }
  const rawTags = Array.isArray(obj["tags"]) ? obj["tags"] : [];
  const tags = normaliseTagArray(rawTags);
  return { kind: "lesson", activation, principle, tags };
}
function normaliseTagArray(raw) {
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > LESSON_TAG_MAX_LENGTH) continue;
    if (!TAG_TOKEN_RE.test(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= LESSON_MAX_TAGS) break;
  }
  return out;
}
const PROC_ACTIVATION_RE = /activation=\"([^\"]+)\"/;
const PROC_STEPS_RE = /steps=\"([^\"]+)\"/;
const PROC_TAGS_RE = /tags=([^"\n;]+)/;
const TOOL_HINT_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\-./]*$/;
class ProcedureDistillParseError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = "ProcedureDistillParseError";
  }
}
function parseDistillWithProcedureOutput(raw) {
  const text = (raw ?? "").trim();
  if (text.startsWith("{")) {
    const fromJson = parseDistillWithProcedureJsonShape(text);
    if (fromJson) return fromJson;
  }
  const base = parseDistillOutput(raw);
  if (base.kind === "none") return base;
  const procLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("PROCEDURE"));
  if (!procLine) {
    return { ...base, procedure: null };
  }
  try {
    const procedure = parseProcedureLine(procLine);
    return { ...base, procedure };
  } catch {
    return { ...base, procedure: null };
  }
}
function parseDistillWithProcedureJsonShape(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;
  const kindField = obj["kind"];
  if (kindField === "none") return { kind: "none" };
  if (kindField !== "lesson") return null;
  const base = parseDistillJsonShape(raw);
  if (!base || base.kind !== "lesson") return null;
  const procField = obj["procedure"];
  if (procField === null || procField === void 0) {
    return { ...base, procedure: null };
  }
  try {
    const procedure = parseProcedureJsonShape(procField);
    return { ...base, procedure };
  } catch {
    return { ...base, procedure: null };
  }
}
function parseProcedureJsonShape(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProcedureDistillParseError(
      "missing_activation",
      "procedure must be an object"
    );
  }
  const rec = raw;
  const activation = typeof rec["activation"] === "string" ? rec["activation"].trim() : "";
  if (activation.length === 0) {
    throw new ProcedureDistillParseError(
      "missing_activation",
      "PROCEDURE activation must be non-empty"
    );
  }
  if (activation.length > PROCEDURE_ACTIVATION_MAX_LENGTH) {
    throw new ProcedureDistillParseError(
      "oversized_activation",
      `procedure activation exceeds ${PROCEDURE_ACTIVATION_MAX_LENGTH} chars`
    );
  }
  const rawSteps = Array.isArray(rec["steps"]) ? rec["steps"] : [];
  if (rawSteps.length < PROCEDURE_MIN_STEPS) {
    throw new ProcedureDistillParseError(
      "too_few_steps",
      `procedure must have at least ${PROCEDURE_MIN_STEPS} steps`
    );
  }
  if (rawSteps.length > PROCEDURE_MAX_STEPS) {
    throw new ProcedureDistillParseError(
      "too_many_steps",
      `procedure must have at most ${PROCEDURE_MAX_STEPS} steps`
    );
  }
  const steps = [];
  for (const entry of rawSteps) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProcedureDistillParseError(
        "missing_activation",
        "step entry must be an object"
      );
    }
    const stepRec = entry;
    const description = typeof stepRec["description"] === "string" ? stepRec["description"].trim() : "";
    if (description.length === 0) continue;
    if (description.length > PROCEDURE_DESCRIPTION_MAX_LENGTH) {
      throw new ProcedureDistillParseError(
        "oversized_step",
        `step description exceeds ${PROCEDURE_DESCRIPTION_MAX_LENGTH} chars`
      );
    }
    let toolHint = null;
    const hintField = stepRec["tool_hint"];
    if (typeof hintField === "string") {
      const candidate = hintField.trim();
      if (candidate.length > 0) {
        if (candidate.length > PROCEDURE_TOOL_HINT_MAX_LENGTH) {
          throw new ProcedureDistillParseError(
            "oversized_tool_hint",
            `tool hint exceeds ${PROCEDURE_TOOL_HINT_MAX_LENGTH} chars`
          );
        }
        if (!TOOL_HINT_TOKEN_RE.test(candidate)) {
          throw new ProcedureDistillParseError(
            "malformed_tool_hint",
            `tool hint must match ${TOOL_HINT_TOKEN_RE}`
          );
        }
        toolHint = candidate;
      }
    }
    steps.push({ description, toolHint });
  }
  if (steps.length < PROCEDURE_MIN_STEPS) {
    throw new ProcedureDistillParseError(
      "too_few_steps",
      `procedure must have at least ${PROCEDURE_MIN_STEPS} non-empty steps`
    );
  }
  const rawTags = Array.isArray(rec["tags"]) ? rec["tags"] : [];
  const tags = [];
  for (const entry of rawTags) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (!PROC_TAG_TOKEN_RE.test(trimmed)) continue;
    if (!tags.includes(trimmed)) tags.push(trimmed);
    if (tags.length >= PROCEDURE_MAX_TAGS) break;
  }
  return { activation, steps, tags };
}
function parseProcedureLine(line) {
  const activationMatch = PROC_ACTIVATION_RE.exec(line);
  const stepsMatch = PROC_STEPS_RE.exec(line);
  if (!activationMatch) {
    throw new ProcedureDistillParseError(
      "missing_activation",
      "PROCEDURE line missing activation"
    );
  }
  if (!stepsMatch) {
    throw new ProcedureDistillParseError(
      "missing_steps",
      "PROCEDURE line missing steps"
    );
  }
  const activation = activationMatch[1].trim();
  if (activation.length === 0 || activation.length > PROCEDURE_ACTIVATION_MAX_LENGTH) {
    throw new ProcedureDistillParseError(
      activation.length === 0 ? "missing_activation" : "oversized_activation",
      `procedure activation must be 1..${PROCEDURE_ACTIVATION_MAX_LENGTH} chars`
    );
  }
  const rawSteps = stepsMatch[1];
  const steps = parseStepsString(rawSteps);
  if (steps.length < PROCEDURE_MIN_STEPS) {
    throw new ProcedureDistillParseError(
      "too_few_steps",
      `procedure must have at least ${PROCEDURE_MIN_STEPS} steps`
    );
  }
  if (steps.length > PROCEDURE_MAX_STEPS) {
    throw new ProcedureDistillParseError(
      "too_many_steps",
      `procedure must have at most ${PROCEDURE_MAX_STEPS} steps`
    );
  }
  const tags = [];
  const afterSteps = line.slice(stepsMatch.index + stepsMatch[0].length);
  const tagsMatch = PROC_TAGS_RE.exec(afterSteps);
  if (tagsMatch) {
    for (const t of parseProcedureTags(tagsMatch[1])) {
      if (!tags.includes(t)) tags.push(t);
      if (tags.length >= PROCEDURE_MAX_TAGS) break;
    }
  }
  return { activation, steps, tags };
}
function parseStepsString(raw) {
  const out = [];
  for (const token of raw.split(/\s*;\s*/)) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const atIdx = trimmed.lastIndexOf("@");
    let description = trimmed;
    let toolHint = null;
    if (atIdx > 0) {
      description = trimmed.slice(0, atIdx).trim();
      const candidate = trimmed.slice(atIdx + 1).trim();
      if (candidate.length > 0) {
        if (candidate.length > PROCEDURE_TOOL_HINT_MAX_LENGTH) {
          throw new ProcedureDistillParseError(
            "oversized_tool_hint",
            `tool hint exceeds ${PROCEDURE_TOOL_HINT_MAX_LENGTH} chars`
          );
        }
        if (!TOOL_HINT_TOKEN_RE.test(candidate)) {
          throw new ProcedureDistillParseError(
            "malformed_tool_hint",
            `tool hint must match ${TOOL_HINT_TOKEN_RE}`
          );
        }
        toolHint = candidate;
      }
    }
    if (description.length === 0) continue;
    if (description.length > PROCEDURE_DESCRIPTION_MAX_LENGTH) {
      throw new ProcedureDistillParseError(
        "oversized_step",
        `step description exceeds ${PROCEDURE_DESCRIPTION_MAX_LENGTH} chars`
      );
    }
    out.push({ description, toolHint });
  }
  return out;
}
const PROC_TAG_TOKEN_RE = /^[a-z][a-z0-9_\-]{0,39}$/;
function parseProcedureTags(raw) {
  const out = [];
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 40) continue;
    if (!PROC_TAG_TOKEN_RE.test(trimmed)) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
export {
  DistillParseError,
  ProcedureDistillParseError,
  parseDistillOutput,
  parseDistillWithProcedureOutput
};
