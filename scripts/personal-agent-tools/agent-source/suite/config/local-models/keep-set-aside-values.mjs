import { isKnownLocalModelId } from "../../local-llm/catalog/models-catalog.mjs";
import { isBackendVariantPreference } from "../../local-llm/backend/windows-backend-variant.mjs";
function keepSetAsideLocalModelValues(data, disk) {
  const lm = disk.localModels;
  const dm = lm && typeof lm === "object" && !Array.isArray(lm) ? lm.managed : null;
  if (!dm || typeof dm !== "object" || Array.isArray(dm)) return data;
  const onDisk = dm;
  const managed = data.localModels.managed;
  const keep = {};
  const id = onDisk.modelId;
  if (typeof id === "string" && managed.modelId === null && !isKnownLocalModelId(id) && !data.localModels.customModels.some((m) => m.id === id)) {
    keep.modelId = id;
  }
  const engine = onDisk.engine;
  if (typeof engine === "string" && engine.length > 0 && engine !== "llama-server" && engine !== "atomic-core") keep.engine = engine;
  const variant = onDisk.backendVariant;
  if (typeof variant === "string" && variant.length > 0 && !isBackendVariantPreference(variant)) keep.backendVariant = variant;
  if (Object.keys(keep).length === 0) return data;
  return { ...data, localModels: { ...data.localModels, managed: { ...managed, ...keep } } };
}
export {
  keepSetAsideLocalModelValues
};
