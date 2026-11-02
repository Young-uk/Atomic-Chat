function matchesAny(matchers, path) {
  for (const m of matchers) {
    if (m.test(path)) return true;
  }
  return false;
}
function compileGlob(pattern, flags = "") {
  let re = "^";
  const len = pattern.length;
  let i = 0;
  while (i < len) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < len) {
      re += escapeRegexChar(pattern[i + 1]);
      i += 2;
      continue;
    }
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        const prevIsBoundary = i === 0 || pattern[i - 1] === "/";
        const nextChar = pattern[i + 2];
        if (prevIsBoundary && nextChar === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
          continue;
        }
        if (prevIsBoundary && nextChar === void 0) {
          re += ".*";
          i += 2;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i++;
      continue;
    }
    if (c === "{") {
      const end = findMatchingBrace(pattern, i);
      if (end !== -1) {
        const inner = pattern.slice(i + 1, end);
        const parts = splitBraceAlternatives(inner).map(
          (alt) => alt.split("").map((ch) => escapeRegexChar(ch)).join("")
        );
        re += "(?:" + parts.join("|") + ")";
        i = end + 1;
        continue;
      }
      re += "\\{";
      i++;
      continue;
    }
    re += escapeRegexChar(c);
    i++;
  }
  re += "$";
  return new RegExp(re, flags);
}
function escapeRegexChar(c) {
  if (/[.+^$|()\\\[\]]/.test(c)) return "\\" + c;
  return c;
}
function findMatchingBrace(pattern, start) {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function splitBraceAlternatives(inner) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of inner) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}
export {
  compileGlob,
  matchesAny
};
