const xlsxExtractor = async (input) => {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(input.data));
  const warnings = [];
  const allSheets = workbook.worksheets;
  const selection = selectSheets(allSheets, input.sheets, warnings);
  const showHeader = input.pageSeparators !== false;
  const parts = [];
  for (const ws of selection) {
    if (showHeader) parts.push(`## Sheet: ${ws.name}`);
    const rowsText = renderSheet(ws);
    if (rowsText.length > 0) parts.push(rowsText);
  }
  return {
    format: "xlsx",
    text: parts.join("\n\n").trim(),
    sheetCount: allSheets.length,
    pagesExtracted: selection.map((s) => allSheets.indexOf(s) + 1),
    warnings
  };
};
function selectSheets(all, requested, warnings) {
  if (!requested || requested.length === 0) return all;
  const picked = [];
  for (const entry of requested) {
    if (typeof entry === "number") {
      const ws = all[entry - 1];
      if (ws) picked.push(ws);
      else warnings.push(`sheet index ${entry} is out of range`);
    } else {
      const ws = all.find((s) => s.name === entry);
      if (ws) picked.push(ws);
      else warnings.push(`sheet ${JSON.stringify(entry)} not found`);
    }
  }
  return picked;
}
function renderSheet(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(renderCell(cell));
    });
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) return;
    rows.push(cells.join(" | "));
  });
  return rows.join("\n");
}
function renderCell(cell) {
  const value = cell.value;
  if (value === null || value === void 0) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const asFormula = value;
    if ("result" in asFormula && asFormula.result !== void 0) {
      return renderCell({ value: asFormula.result });
    }
    if ("formula" in asFormula && typeof asFormula.formula === "string") {
      return `=${asFormula.formula}`;
    }
    const asRichText = value;
    if (Array.isArray(asRichText.richText)) {
      return asRichText.richText.map((r) => r.text ?? "").join("");
    }
    const asHyperlink = value;
    if (typeof asHyperlink.text === "string") return asHyperlink.text;
  }
  return String(value);
}
function toArrayBuffer(buf) {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}
let excelJsModule;
async function loadExcelJs() {
  if (!excelJsModule) {
    const mod = await import("exceljs");
    excelJsModule = "default" in mod ? mod.default : mod;
  }
  return excelJsModule;
}
export {
  xlsxExtractor
};
