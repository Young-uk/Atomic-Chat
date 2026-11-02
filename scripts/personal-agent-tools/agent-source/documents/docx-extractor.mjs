const docxExtractor = async (input) => {
  const mammoth = await loadMammoth();
  const warnings = [];
  const convertFn = input.includeTables === false ? mammoth.extractRawText : mammoth.convertToMarkdown;
  const result = await convertFn({ buffer: input.data });
  for (const msg of result.messages) {
    if (msg.type === "error" || msg.type === "warning") {
      warnings.push(`${msg.type}: ${msg.message}`);
    }
  }
  const text = normaliseMarkdown(result.value);
  return {
    format: "docx",
    text,
    warnings
  };
};
function normaliseMarkdown(raw) {
  return raw.replace(/\n{3,}/g, "\n\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();
}
let mammothModule;
async function loadMammoth() {
  if (!mammothModule) {
    const mod = await import("mammoth");
    mammothModule = "default" in mod ? mod.default : mod;
  }
  return mammothModule;
}
export {
  docxExtractor
};
