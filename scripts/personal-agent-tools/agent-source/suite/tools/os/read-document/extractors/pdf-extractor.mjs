import Module, { createRequire } from "node:module";
const pdfExtractor = async (input) => {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(input.data),
    // Nobody calls disable-font-face in Node; pdfjs handles the missing
    // DOM gracefully. We DO disable the worker to keep things single-thread.
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    // 0 = ERRORS only. Suppresses the cosmetic "standardFontDataUrl not
    // provided" warning — we don't render fonts, just extract glyph runs.
    // Note this only governs per-document warnings; import-time warnings are
    // handled by `withQuietCanvasResolution` below.
    verbosity: 0
  }).promise;
  const warnings = [];
  const totalPages = doc.numPages;
  const { start, end } = clampPageRange(totalPages, input);
  const maxPages = input.maxPages ?? totalPages;
  const separators = input.pageSeparators !== false;
  const extracted = [];
  const chunks = [];
  for (let pageNum = start; pageNum <= end; pageNum++) {
    if (extracted.length >= maxPages) break;
    try {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = assembleLines(content.items);
      if (separators) {
        chunks.push(`--- page ${pageNum} ---
${pageText}`);
      } else if (pageText.length > 0) {
        chunks.push(pageText);
      }
      extracted.push(pageNum);
    } catch (err) {
      warnings.push(
        `page ${pageNum}: failed to extract (${err.message})`
      );
    }
  }
  try {
    await doc.destroy();
  } catch {
  }
  const result = {
    format: "pdf",
    text: chunks.join("\n\n").trim(),
    pageCount: totalPages,
    pagesExtracted: extracted,
    warnings
  };
  return result;
};
function assembleLines(items) {
  if (items.length === 0) return "";
  const lines = [];
  let currentLine = "";
  let lastY = null;
  for (const item of items) {
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
      lines.push(currentLine.trimEnd());
      currentLine = "";
    }
    currentLine += item.str;
    if (item.hasEOL) {
      lines.push(currentLine.trimEnd());
      currentLine = "";
    }
    lastY = y ?? lastY;
  }
  if (currentLine.length > 0) lines.push(currentLine.trimEnd());
  return lines.filter((l) => l.length > 0).join("\n");
}
function clampPageRange(total, input) {
  const from = input.pagesFrom ?? 1;
  const to = input.pagesTo ?? total;
  return {
    start: Math.max(1, Math.min(from, total)),
    end: Math.max(1, Math.min(to, total))
  };
}
let pdfJsPromise;
function loadPdfJs() {
  pdfJsPromise ??= (async () => {
    const mod = await withQuietCanvasResolution(
      () => import("pdfjs-dist/legacy/build/pdf.mjs")
    );
    await ensurePdfWorkerOnMainThread();
    return mod;
  })();
  return pdfJsPromise;
}
async function withQuietCanvasResolution(load) {
  if (canvasPackageIsInstalled()) return load();
  const nodeModule = Module;
  const originalLoad = nodeModule._load;
  if (typeof originalLoad !== "function") return load();
  nodeModule._load = function patchedLoad(...args) {
    if (args[0] === CANVAS_PACKAGE) return CANVAS_STUB;
    return originalLoad.apply(this, args);
  };
  try {
    return await load();
  } finally {
    nodeModule._load = originalLoad;
  }
}
const CANVAS_PACKAGE = "@napi-rs/canvas";
const CANVAS_STUB = {
  DOMMatrix: class DOMMatrixStub {
  },
  ImageData: class ImageDataStub {
  },
  Path2D: class Path2DStub {
  }
};
function canvasPackageIsInstalled() {
  try {
    createRequire(import.meta.url).resolve(CANVAS_PACKAGE);
    return true;
  } catch {
    return false;
  }
}
async function ensurePdfWorkerOnMainThread() {
  const slot = globalThis;
  if (slot.pdfjsWorker?.WorkerMessageHandler) return;
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  slot.pdfjsWorker = workerModule;
}
export {
  pdfExtractor
};
