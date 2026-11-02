import { compressToolResult } from "../../compressor/result-compressor.mjs";
let cached = null;
async function loadClipboard() {
  if (cached) return cached;
  const mod = await import("clipboardy");
  const api = {
    read: () => mod.default.read(),
    write: (value) => mod.default.write(value)
  };
  cached = api;
  return api;
}
const osClipboardReadTool = {
  name: "os.clipboard.read",
  description: "Read the system clipboard as UTF-8 text.",
  readonly: true,
  async run() {
    const clip = await loadClipboard();
    const value = await clip.read();
    return compressToolResult(
      {
        tool: "os.clipboard.read",
        status: "ok",
        output: value,
        details: { bytes: value.length }
      },
      { maxSummaryLength: 2e3, maxTailLines: 200 }
    );
  }
};
const osClipboardWriteTool = {
  name: "os.clipboard.write",
  description: "Overwrite the system clipboard with UTF-8 text.",
  readonly: false,
  async run(rawArgs) {
    const value = rawArgs.value;
    if (typeof value !== "string") {
      throw new Error("os.clipboard.write: `value` must be a string");
    }
    const clip = await loadClipboard();
    await clip.write(value);
    return compressToolResult({
      tool: "os.clipboard.write",
      status: "ok",
      output: `wrote ${value.length} chars to clipboard`,
      details: { bytes: value.length }
    });
  }
};
export {
  osClipboardReadTool,
  osClipboardWriteTool
};
