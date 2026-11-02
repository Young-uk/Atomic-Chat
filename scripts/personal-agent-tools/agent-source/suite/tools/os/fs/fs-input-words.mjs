const REPLACE_VERBS = [
  "rewrite",
  "replace",
  "regenerate",
  "overwrite",
  "recreate",
  "reset"
];
const REPLACE_STEMS_RU = ["\u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0438\u0441", "\u0437\u0430\u043C\u0435\u043D", "\u043F\u0435\u0440\u0435\u043F\u0438\u0441", "\u043F\u0435\u0440\u0435\u043F\u0438\u0448", "\u043F\u0435\u0440\u0435\u0441\u043E\u0437\u0434"];
const REPLACE_VERB_WINDOW_WORDS = 6;
const NEGATIONS = /* @__PURE__ */ new Set([
  "not",
  "never",
  "don't",
  "dont",
  "no",
  "nor",
  "without",
  "than",
  "instead",
  "\u043D\u0435",
  "\u0431\u0435\u0437",
  "\u0432\u043C\u0435\u0441\u0442\u043E",
  "\u043D\u0435\u043B\u044C\u0437\u044F"
]);
const NEGATION_WINDOW_WORDS = 3;
const NAME_CHAR = /[A-Za-z0-9_.-]/;
const SENTENCE_END = /[.!?;:]$/;
function bareToken(word) {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}']+/u, "").replace(/[^\p{L}\p{N}']+$/u, "");
}
function requestNamesFile(request, name) {
  const haystack = request.toLowerCase();
  const needle = name.toLowerCase();
  if (needle.length === 0) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (isWholeName(haystack, at, at + needle.length)) return true;
  }
  return false;
}
function isWholeName(text, start, end) {
  const before = text[start - 1];
  if (before !== void 0 && NAME_CHAR.test(before)) return false;
  const after = text[end];
  if (after === void 0) return true;
  if (after === ".") {
    const next = text[end + 1];
    return next === void 0 || !NAME_CHAR.test(next);
  }
  return !NAME_CHAR.test(after);
}
function requestAsksToReplace(request, name) {
  return replaceVerbReaches(request, (word) => requestNamesFile(word, name));
}
function replaceVerbReaches(text, matches) {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  for (let i = 0; i < words.length; i += 1) {
    if (!isReplaceVerb(words[i]) || isNegated(words, i)) continue;
    const window = words.slice(i + 1, i + 1 + REPLACE_VERB_WINDOW_WORDS);
    for (let j = 0; j < window.length; j += 1) {
      const word = window[j];
      if (matches(word, window[j + 1])) return true;
      if (SENTENCE_END.test(word)) break;
    }
  }
  return false;
}
function isReplaceVerb(word) {
  const bare = bareToken(word);
  return REPLACE_VERBS.some((verb) => bare.startsWith(verb.replace(/e$/, ""))) || REPLACE_STEMS_RU.some((stem) => bare.startsWith(stem));
}
function isNegated(words, verbAt) {
  const from = Math.max(0, verbAt - NEGATION_WINDOW_WORDS);
  for (let i = from; i < verbAt; i += 1) {
    if (NEGATIONS.has(bareToken(words[i]))) return true;
  }
  return false;
}
export {
  REPLACE_VERBS,
  REPLACE_VERB_WINDOW_WORDS,
  SENTENCE_END,
  bareToken,
  replaceVerbReaches,
  requestAsksToReplace,
  requestNamesFile
};
