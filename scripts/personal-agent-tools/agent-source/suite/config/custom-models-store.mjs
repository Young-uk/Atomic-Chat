import {
  ensureUserConfigFileSync,
  writeUserConfigFileSync
} from "./config-file.mjs";
import { parseUserConfigFile } from "./config-schema.mjs";
import { getConfig, resetConfigCache } from "./config-cache.mjs";
import { setCustomLocalModels } from "../local-llm/catalog/models-catalog.mjs";
function writeCustomModels(defs) {
  const path = getConfig().paths.userConfigFile;
  const previous = ensureUserConfigFileSync(path);
  const activeId = previous.localModels.managed.modelId;
  const activeSurvives = activeId === null || !activeId.startsWith("custom-") || defs.some((def) => def.id === activeId);
  const validated = parseUserConfigFile({
    ...previous,
    localModels: {
      ...previous.localModels,
      customModels: [...defs],
      managed: {
        ...previous.localModels.managed,
        modelId: activeSurvives ? activeId : null
      }
    }
  });
  writeUserConfigFileSync(path, validated);
  setCustomLocalModels(validated.localModels.customModels);
  resetConfigCache();
}
function addCustomModel(def) {
  const path = getConfig().paths.userConfigFile;
  const previous = ensureUserConfigFileSync(path);
  const kept = previous.localModels.customModels.filter((m) => m.id !== def.id);
  writeCustomModels([...kept, def]);
}
function removeCustomModel(id) {
  const path = getConfig().paths.userConfigFile;
  const previous = ensureUserConfigFileSync(path);
  const kept = previous.localModels.customModels.filter((m) => m.id !== id);
  if (kept.length === previous.localModels.customModels.length) return false;
  writeCustomModels(kept);
  return true;
}
export {
  addCustomModel,
  removeCustomModel
};
