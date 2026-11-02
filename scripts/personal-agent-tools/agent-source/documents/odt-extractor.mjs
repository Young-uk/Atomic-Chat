import {
  joinExtracted,
  openZip,
  parseXml,
  readZipText,
  walkText
} from "./zip-xml-helpers.mjs";
const odtExtractor = async (input) => {
  const warnings = [];
  const zip = await openZip(input.data);
  const contentXml = await readZipText(zip, "content.xml");
  if (!contentXml) {
    return { format: "odt", text: "", warnings: ["content.xml missing"] };
  }
  const tree = parseXml(contentXml);
  const parts = renderOdt(tree, warnings);
  return {
    format: "odt",
    text: joinExtracted(parts),
    warnings
  };
};
function renderOdt(tree, _warnings) {
  const out = [];
  visit(tree, out);
  return out;
}
function visit(nodes, out) {
  for (const item of nodes) {
    const tag = Object.keys(item).find((k) => k !== ":@");
    if (!tag) continue;
    const children = item[tag];
    const attrs = item[":@"];
    if (tag === "text:h") {
      const level = parseOutlineLevel(attrs);
      const inline = [];
      walkText(
        children,
        {
          isTextTag: () => false,
          paragraphTags: () => false
        },
        inline
      );
      const text = collectInlineText(children);
      if (text.trim().length > 0) {
        const prefix = "#".repeat(Math.min(level, 6));
        out.push(`${prefix} ${text.trim()}

`);
      }
      continue;
    }
    if (tag === "text:p") {
      const text = collectInlineText(children);
      if (text.trim().length > 0) out.push(`${text.trim()}

`);
      continue;
    }
    if (Array.isArray(children)) {
      visit(children, out);
    }
  }
}
function collectInlineText(nodes) {
  if (!nodes) return "";
  const parts = [];
  for (const item of nodes) {
    const tag = Object.keys(item).find((k) => k !== ":@");
    if (!tag) continue;
    const children = item[tag];
    if (tag === "#text") {
      if (typeof children === "string") parts.push(children);
      else if (typeof children === "number") parts.push(String(children));
      continue;
    }
    if (Array.isArray(children)) {
      parts.push(collectInlineText(children));
    }
  }
  return parts.join("");
}
function parseOutlineLevel(attrs) {
  if (!attrs) return 1;
  const raw = attrs["@_text:outline-level"];
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}
export {
  odtExtractor
};
