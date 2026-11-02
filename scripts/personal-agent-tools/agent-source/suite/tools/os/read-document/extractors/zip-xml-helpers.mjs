import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false
});
async function openZip(data) {
  return JSZip.loadAsync(data);
}
async function readZipText(zip, path) {
  const file = zip.file(path);
  if (!file) return void 0;
  return file.async("text");
}
function parseXml(xml) {
  return xmlParser.parse(xml);
}
function walkText(node, options, out = []) {
  if (!node) return out;
  for (const item of node) {
    const tag = Object.keys(item).find((k) => k !== ":@");
    if (!tag) continue;
    const children = item[tag];
    if (options.isTextTag(tag)) {
      if (Array.isArray(children)) {
        for (const ch of children) {
          const text = ch["#text"];
          if (typeof text === "string") out.push(text);
          else if (typeof text === "number") out.push(String(text));
        }
      }
      continue;
    }
    if (Array.isArray(children)) {
      walkText(children, options, out);
    }
    if (options.paragraphTags?.(tag)) {
      out.push("\n");
    }
  }
  return out;
}
function joinExtracted(parts) {
  const raw = parts.join("");
  return raw.replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
}
export {
  joinExtracted,
  openZip,
  parseXml,
  readZipText,
  walkText
};
