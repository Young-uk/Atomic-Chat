function parseRipgrepJson(stdout) {
  const files = /* @__PURE__ */ new Map();
  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    if (rawLine.length === 0) continue;
    let envelope;
    try {
      envelope = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (envelope.type !== "match" && envelope.type !== "context") continue;
    const path = extractText(envelope.data.path);
    if (path === void 0) continue;
    const lineNumber = typeof envelope.data.line_number === "number" ? envelope.data.line_number : 0;
    const text = extractText(envelope.data.lines) ?? "";
    const submatchesRaw = Array.isArray(envelope.data.submatches) ? envelope.data.submatches : [];
    const submatches = submatchesRaw.map((sm) => ({
      start: typeof sm.start === "number" ? sm.start : 0,
      end: typeof sm.end === "number" ? sm.end : 0,
      text: extractText(sm.match) ?? ""
    }));
    const existing = files.get(path) ?? {
      path,
      matches: [],
      matchCount: 0
    };
    existing.matches.push({
      lineNumber,
      text: text.replace(/\r?\n$/, ""),
      submatches,
      isContext: envelope.type === "context"
    });
    if (envelope.type === "match") existing.matchCount++;
    files.set(path, existing);
  }
  return Array.from(files.values());
}
function extractText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const text = value.text;
    if (typeof text === "string") return text;
    const bytes = value.bytes;
    if (typeof bytes === "string") {
      try {
        return Buffer.from(bytes, "base64").toString("utf8");
      } catch {
        return void 0;
      }
    }
  }
  return void 0;
}
export {
  parseRipgrepJson
};
