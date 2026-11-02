import {
  joinExtracted,
  openZip,
  parseXml,
  readZipText
} from "./zip-xml-helpers.mjs";
const pptxExtractor = async (input) => {
  const warnings = [];
  const zip = await openZip(input.data);
  const slidePaths = listSlides(zip);
  if (slidePaths.length === 0) {
    return {
      format: "pptx",
      text: "",
      slideCount: 0,
      warnings: ["no slides found"]
    };
  }
  const slideCount = slidePaths.length;
  const start = input.pagesFrom ?? 1;
  const end = input.pagesTo ?? slideCount;
  const maxPages = input.maxPages ?? slideCount;
  const separators = input.pageSeparators !== false;
  const extracted = [];
  const chunks = [];
  for (let n = start; n <= end; n++) {
    if (extracted.length >= maxPages) break;
    const path = slidePaths[n - 1];
    if (!path) continue;
    try {
      const xml = await readZipText(zip, path);
      if (!xml) continue;
      const text = extractSlideText(xml);
      if (separators) {
        chunks.push(`--- slide ${n} ---
${text}`);
      } else if (text.length > 0) {
        chunks.push(text);
      }
      extracted.push(n);
    } catch (err) {
      warnings.push(`slide ${n}: failed to parse (${err.message})`);
    }
  }
  return {
    format: "pptx",
    text: joinExtracted(chunks).replace(/\n{2,}---/g, "\n\n---"),
    slideCount,
    pagesExtracted: extracted,
    warnings
  };
};
function listSlides(zip) {
  const paths = [];
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(relativePath)) {
      paths.push(relativePath);
    }
  });
  paths.sort((a, b) => slideNumber(a) - slideNumber(b));
  return paths;
}
function slideNumber(path) {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m?.[1] ? parseInt(m[1], 10) : 0;
}
function extractSlideText(xml) {
  const tree = parseXml(xml);
  const out = [];
  visit(tree, out);
  return out.join("").trim();
}
function visit(nodes, out) {
  for (const item of nodes) {
    const tag = Object.keys(item).find((k) => k !== ":@");
    if (!tag) continue;
    const children = item[tag];
    if (tag === "a:t") {
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
      visit(children, out);
    }
    if (tag === "a:p") out.push("\n");
  }
}
export {
  pptxExtractor
};
