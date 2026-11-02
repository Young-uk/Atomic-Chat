import { ConfigValidationError } from "./config-validation-error.mjs";
import { parsePositiveInt, parseBoundedPositiveInt, parseBool } from "./config-primitives.mjs";
import { parseUrl } from "./config-values.mjs";
const DEFAULT_SKILLS_CATALOG_BUDGET = 512;
const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const TAP_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
function parseSkillNameArray(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected string[], got ${JSON.stringify(raw)}`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected non-empty string, got ${JSON.stringify(entry)}`
      );
    }
    if (!SKILL_NAME_RE.test(entry)) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected kebab-case skill name, got ${JSON.stringify(entry)}`
      );
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
function parseSkillTapArray(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigValidationError(
      field,
      `expected string[], got ${JSON.stringify(raw)}`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected non-empty string, got ${JSON.stringify(entry)}`
      );
    }
    if (!TAP_REPO_RE.test(entry)) {
      throw new ConfigValidationError(
        `${field}[${i}]`,
        `expected GitHub owner/repo, got ${JSON.stringify(entry)}`
      );
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
function parseClawHubConfigWithDefaults(raw, readDefaults) {
  const defaults = readDefaults();
  if (raw === void 0 || raw === null) return { ...defaults };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(
      "skills.clawhub",
      `expected object, got ${JSON.stringify(raw)}`
    );
  }
  const obj = raw;
  return {
    enabled: parseBool(
      obj.enabled ?? defaults.enabled,
      "skills.clawhub.enabled"
    ),
    apiBase: parseUrl(
      obj.apiBase ?? defaults.apiBase,
      "skills.clawhub.apiBase"
    ),
    browseLimit: parsePositiveInt(
      obj.browseLimit ?? defaults.browseLimit,
      "skills.clawhub.browseLimit"
    ),
    nonSuspiciousOnly: parseBool(
      obj.nonSuspiciousOnly ?? defaults.nonSuspiciousOnly,
      "skills.clawhub.nonSuspiciousOnly"
    )
  };
}
function createSkillsDefaults() {
  return {
    catalogTokenBudget: DEFAULT_SKILLS_CATALOG_BUDGET,
    disabled: [],
    cloudWorkspaces: [],
    projectTrust: [],
    taps: ["anthropics/skills", "openai/skills", "vercel-labs/agent-skills"],
    clawhub: {
      enabled: true,
      apiBase: "https://clawhub.ai",
      browseLimit: 100,
      nonSuspiciousOnly: true
    }
  };
}
function parseSkillsConfig(skills, readDefaults) {
  return {
    cloudWorkspaces: parseCloudWorkspaces(skills.cloudWorkspaces),
    projectTrust: parseProjectTrust(skills.projectTrust),
    catalogTokenBudget: parseBoundedPositiveInt(
      skills.catalogTokenBudget ?? readDefaults().catalogTokenBudget,
      "skills.catalogTokenBudget",
      1,
      1e5
    ),
    disabled: parseSkillNameArray(
      skills.disabled ?? readDefaults().disabled,
      "skills.disabled"
    ),
    taps: parseSkillTapArray(
      skills.taps ?? readDefaults().taps,
      "skills.taps"
    ),
    clawhub: parseClawHubConfigWithDefaults(skills.clawhub, () => readDefaults().clawhub)
  };
}
function parseCloudWorkspaces(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConfigValidationError("skills.cloudWorkspaces", "expected an array");
  const seen = /* @__PURE__ */ new Set();
  return raw.map((entry, index) => {
    const field = `skills.cloudWorkspaces[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ConfigValidationError(field, "expected an object");
    const value = entry;
    if (typeof value.workingDir !== "string" || !value.workingDir.trim()) throw new ConfigValidationError(`${field}.workingDir`, "expected a non-empty path");
    if (seen.has(value.workingDir)) throw new ConfigValidationError(field, "duplicate workspace");
    seen.add(value.workingDir);
    return {
      workingDir: value.workingDir,
      projectSkillsEnabled: parseBool(value.projectSkillsEnabled ?? true, `${field}.projectSkillsEnabled`),
      disabled: parseSkillNameArray(value.disabled, `${field}.disabled`)
    };
  });
}
function parseProjectTrust(raw) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConfigValidationError("skills.projectTrust", "expected an array");
  const seen = /* @__PURE__ */ new Set();
  return raw.map((entry, index) => {
    const field = `skills.projectTrust[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ConfigValidationError(field, "expected an object");
    const value = entry;
    if (typeof value.workingDir !== "string" || !value.workingDir.trim()) throw new ConfigValidationError(`${field}.workingDir`, "expected a non-empty path");
    if (seen.has(value.workingDir)) throw new ConfigValidationError(field, "duplicate workspace");
    seen.add(value.workingDir);
    return {
      workingDir: value.workingDir,
      trustedSkills: parseSkillNameArray(value.trustedSkills, `${field}.trustedSkills`),
      declinedSkills: parseSkillNameArray(value.declinedSkills, `${field}.declinedSkills`),
      trustedInstructions: parseInstructionPathArray(value.trustedInstructions, `${field}.trustedInstructions`),
      declinedInstructions: parseInstructionPathArray(value.declinedInstructions, `${field}.declinedInstructions`)
    };
  });
}
function parseInstructionPathArray(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConfigValidationError(field, `expected string[], got ${JSON.stringify(raw)}`);
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  raw.forEach((entry, i) => {
    if (typeof entry !== "string" || !isRelativeInstructionPath(entry)) {
      throw new ConfigValidationError(`${field}[${i}]`, `expected a workspace-relative path, got ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry)) return;
    seen.add(entry);
    result.push(entry);
  });
  return result;
}
function isRelativeInstructionPath(path) {
  if (!path || path.length > 4096 || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
export {
  DEFAULT_SKILLS_CATALOG_BUDGET,
  createSkillsDefaults,
  isRelativeInstructionPath,
  parseClawHubConfigWithDefaults,
  parseSkillNameArray,
  parseSkillTapArray,
  parseSkillsConfig
};
