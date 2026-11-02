import { DEFAULT_TOOL_DESCRIPTORS_A } from "./default-tool-descriptors-a.mjs";
import { DEFAULT_TOOL_DESCRIPTORS_B } from "./default-tool-descriptors-b.mjs";
import { attachDefaultArgsJsonSchema } from "./default-tool-args-schemas.mjs";
const DEFAULT_TOOL_DESCRIPTORS = [
  ...DEFAULT_TOOL_DESCRIPTORS_A,
  ...DEFAULT_TOOL_DESCRIPTORS_B
].map(attachDefaultArgsJsonSchema);
const TOOL_DESCRIPTOR_BY_NAME = new Map(
  DEFAULT_TOOL_DESCRIPTORS.map((d) => [d.name, d])
);
function getToolDescriptorByName(name) {
  return TOOL_DESCRIPTOR_BY_NAME.get(name);
}
function isRareToolName(name) {
  return getToolDescriptorByName(name)?.tier === "rare";
}
export {
  DEFAULT_TOOL_DESCRIPTORS,
  getToolDescriptorByName,
  isRareToolName
};
