const CSS_CHECKER = "css-braces";
function checkCssSource(file, content) {
  let depth = 0;
  let line = 1;
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === "\n") {
      line += 1;
      i += 1;
    } else if (ch === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      line += countNewlines(content, i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      const stop = skipString(content, i, ch);
      line += countNewlines(content, i, stop);
      i = stop;
    } else if (ch === "{") {
      depth += 1;
      i += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth < 0) {
        return {
          file,
          ok: false,
          checker: CSS_CHECKER,
          error: `unexpected \`}\` at line ${line} (no open block)`
        };
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  if (depth > 0) {
    return {
      file,
      ok: false,
      checker: CSS_CHECKER,
      error: `${depth} unclosed \`{\` at end of file`
    };
  }
  return { file, ok: true, checker: CSS_CHECKER };
}
function skipString(text, start, quote) {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote || ch === "\n") return i + 1;
    i += 1;
  }
  return text.length;
}
function countNewlines(text, from, to) {
  let count = 0;
  for (let i = from; i < to; i += 1) if (text[i] === "\n") count += 1;
  return count;
}
export {
  CSS_CHECKER,
  checkCssSource
};
