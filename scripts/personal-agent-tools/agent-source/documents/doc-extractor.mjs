import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function createDocExtractor(loadClient, writeTempFile) {
  return async (input) => {
    const warnings = [];
    const client = await loadClient();
    const temp = await writeTempFile(input.data);
    try {
      const doc = await client.extract(temp.path);
      const raw = doc.getBody();
      const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return {
        format: "doc",
        text,
        warnings
      };
    } finally {
      await temp.cleanup().catch(() => void 0);
    }
  };
}
async function defaultTempWrite(data) {
  const path = join(
    tmpdir(),
    `atomic-agent-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.doc`
  );
  await writeFile(path, data);
  return {
    path,
    async cleanup() {
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
    }
  };
}
async function defaultLoadClient() {
  const mod = await import("word-extractor");
  const Ctor = "default" in mod ? mod.default : mod;
  return new Ctor();
}
const docExtractor = createDocExtractor(
  defaultLoadClient,
  defaultTempWrite
);
export {
  createDocExtractor,
  docExtractor
};
