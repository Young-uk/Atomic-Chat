import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigValidationError } from "./config-validation-error.mjs";
const CUSTOM_ID_RE = /^custom-[a-z0-9._-]+$/;
function requireString(raw, field) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ConfigValidationError(field, `expected a non-empty string`);
  }
  return raw;
}
function requireSafeFilename(raw, field) {
  const str = requireString(raw, field);
  if (str.includes("/") || str.includes("\\") || str.startsWith(".")) {
    throw new ConfigValidationError(
      field,
      `expected a bare filename (no path separators, no leading dot), got ${JSON.stringify(str)}`
    );
  }
  return str;
}
function requireUrl(raw, field) {
  const str = requireString(raw, field);
  try {
    new URL(str);
  } catch {
    throw new ConfigValidationError(
      field,
      `expected a valid URL, got ${JSON.stringify(raw)}`
    );
  }
  return str;
}
function optionalLocalPath(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  const str = requireString(raw, field);
  if (!isAbsolute(str) || !/\.gguf$/i.test(str)) {
    throw new ConfigValidationError(
      field,
      `expected an absolute path to a .gguf file, got ${JSON.stringify(str)}`
    );
  }
  return str;
}
function localPathFromFileUrl(url) {
  if (!url.startsWith("file:")) return void 0;
  let path;
  try {
    path = fileURLToPath(url);
  } catch {
    return void 0;
  }
  return isAbsolute(path) && /\.gguf$/i.test(path) ? path : void 0;
}
function optionalNumber(raw, field, fallback) {
  if (raw === void 0 || raw === null) return fallback;
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigValidationError(
      field,
      `expected a non-negative number, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
function optionalString(raw, fallback) {
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}
function parseCustomLocalModel(raw, field) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(field, "expected an object");
  }
  const entry = raw;
  const id = requireString(entry.id, `${field}.id`);
  if (!CUSTOM_ID_RE.test(id)) {
    throw new ConfigValidationError(
      `${field}.id`,
      `expected /^custom-[a-z0-9._-]+$/, got ${JSON.stringify(id)}`
    );
  }
  const fileSizeGb = optionalNumber(entry.fileSizeGb, `${field}.fileSizeGb`, 0);
  const supportsVision = entry.supportsVision === true;
  const storedLocalPath = optionalLocalPath(
    entry.localPath,
    `${field}.localPath`
  );
  const filename = requireSafeFilename(entry.filename, `${field}.filename`);
  const huggingFaceUrl = requireUrl(
    entry.huggingFaceUrl,
    `${field}.huggingFaceUrl`
  );
  const localPath = storedLocalPath ?? localPathFromFileUrl(huggingFaceUrl);
  const def = {
    id,
    name: optionalString(entry.name, id),
    filename,
    huggingFaceUrl,
    fileSizeGb,
    sizeLabel: optionalString(entry.sizeLabel, `${fileSizeGb.toFixed(1)} GB`),
    description: optionalString(entry.description, "Custom model"),
    maxContextLength: optionalNumber(
      entry.maxContextLength,
      `${field}.maxContextLength`,
      0
    ),
    contextLabel: optionalString(entry.contextLabel, "auto"),
    minRamGb: optionalNumber(entry.minRamGb, `${field}.minRamGb`, 1),
    recommendedRamGb: optionalNumber(
      entry.recommendedRamGb,
      `${field}.recommendedRamGb`,
      2
    ),
    family: "custom",
    supportsVision,
    ...localPath !== void 0 ? { localPath } : {}
  };
  if (!supportsVision) return def;
  return {
    ...def,
    mmprojUrl: requireUrl(entry.mmprojUrl, `${field}.mmprojUrl`),
    mmprojFilename: requireSafeFilename(
      entry.mmprojFilename,
      `${field}.mmprojFilename`
    ),
    mmprojFileSizeGb: optionalNumber(
      entry.mmprojFileSizeGb,
      `${field}.mmprojFileSizeGb`,
      0
    )
  };
}
function parseCustomLocalModels(raw, field) {
  if (raw === void 0 || raw === null) return [];
  if (!Array.isArray(raw))
    throw new ConfigValidationError(field, "expected an array");
  const parsed = raw.map(
    (entry, i) => parseCustomLocalModel(entry, `${field}[${i}]`)
  );
  const seen = /* @__PURE__ */ new Set();
  for (const def of parsed) {
    if (seen.has(def.id)) {
      throw new ConfigValidationError(
        field,
        `duplicate custom model id: ${def.id}`
      );
    }
    seen.add(def.id);
  }
  return parsed;
}
export {
  parseCustomLocalModel,
  parseCustomLocalModels
};
