const rtfExtractor = async (input) => {
  const warnings = [];
  const source = input.data.toString("latin1");
  const text = parseRtf(source, warnings);
  return {
    format: "rtf",
    text: text.replace(/[\t ]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim(),
    warnings
  };
};
const IGNORABLE_DESTINATIONS = /* @__PURE__ */ new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "objdata",
  "header",
  "footer",
  "footnote",
  "generator",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "revtbl"
]);
function parseRtf(src, warnings) {
  let i = 0;
  const out = [];
  const groupStack = [];
  let ignoreDepth = 0;
  const emit = (s) => {
    if (ignoreDepth === 0) out.push(s);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      let look = i + 1;
      while (look < src.length && (src[look] === " " || src[look] === "\n")) {
        look++;
      }
      let isIgnorable = false;
      if (src[look] === "\\" && src[look + 1] === "*") {
        isIgnorable = true;
      } else if (src[look] === "\\") {
        const match = /^\\([a-zA-Z]+)/.exec(src.slice(look));
        const destination = match?.[1];
        if (destination && IGNORABLE_DESTINATIONS.has(destination)) {
          isIgnorable = true;
        }
      }
      groupStack.push({ ignore: isIgnorable });
      if (isIgnorable) ignoreDepth++;
      i++;
      continue;
    }
    if (ch === "}") {
      const popped = groupStack.pop();
      if (popped?.ignore) ignoreDepth--;
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
        continue;
      }
      if (next === "~") {
        emit("\xA0");
        i += 2;
        continue;
      }
      if (next === "-" || next === "_") {
        emit("-");
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          const byte = parseInt(hex, 16);
          emit(decodeCp1252Byte(byte));
          i += 4;
          continue;
        }
        warnings.push(`malformed \\' escape near offset ${i}`);
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
        continue;
      }
      const cwMatch = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(src.slice(i));
      if (cwMatch && cwMatch[1]) {
        const word = cwMatch[1];
        const param = cwMatch[2];
        i += cwMatch[0].length;
        if (word === "u" && param) {
          const code = parseInt(param, 10);
          const cp = code < 0 ? code + 65536 : code;
          emit(String.fromCodePoint(cp));
          i += skipUnicodeFallback(src, i, 1);
          continue;
        }
        handleControlWord(word, param, emit);
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch !== void 0) emit(ch);
    i++;
  }
  return out.join("");
}
function handleControlWord(word, _param, emit) {
  switch (word) {
    case "par":
    case "line":
    case "sect":
    case "page":
      emit("\n");
      return;
    case "tab":
      emit("	");
      return;
    case "emdash":
      emit("\u2014");
      return;
    case "endash":
      emit("\u2013");
      return;
    case "lquote":
      emit("\u2018");
      return;
    case "rquote":
      emit("\u2019");
      return;
    case "ldblquote":
      emit("\u201C");
      return;
    case "rdblquote":
      emit("\u201D");
      return;
    case "bullet":
      emit("\u2022");
      return;
    default:
      return;
  }
}
const CP1252_OVERRIDES = {
  128: "\u20AC",
  130: "\u201A",
  131: "\u0192",
  132: "\u201E",
  133: "\u2026",
  134: "\u2020",
  135: "\u2021",
  136: "\u02C6",
  137: "\u2030",
  138: "\u0160",
  139: "\u2039",
  140: "\u0152",
  142: "\u017D",
  145: "\u2018",
  146: "\u2019",
  147: "\u201C",
  148: "\u201D",
  149: "\u2022",
  150: "\u2013",
  151: "\u2014",
  152: "\u02DC",
  153: "\u2122",
  154: "\u0161",
  155: "\u203A",
  156: "\u0153",
  158: "\u017E",
  159: "\u0178"
};
function skipUnicodeFallback(src, from, count) {
  let consumed = 0;
  let remaining = count;
  while (remaining > 0 && from + consumed < src.length) {
    const ch = src[from + consumed];
    if (ch === "\\") {
      if (src[from + consumed + 1] === "'" && /^[0-9a-fA-F]{2}$/.test(
        src.slice(from + consumed + 2, from + consumed + 4)
      )) {
        consumed += 4;
        remaining--;
        continue;
      }
      break;
    }
    if (ch === "{" || ch === "}" || ch === "\r" || ch === "\n") break;
    consumed++;
    remaining--;
  }
  return consumed;
}
function decodeCp1252Byte(byte) {
  const override = CP1252_OVERRIDES[byte];
  if (override) return override;
  return String.fromCharCode(byte);
}
export {
  rtfExtractor
};
