import { isNameProfileKey } from "./profile-name-keys.mjs";
function normaliseProfileValue(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.!?;,]+$/u, "");
}
const FILLER_WORDS = /* @__PURE__ */ new Set([
  "user",
  "users",
  "my",
  "the",
  "a",
  "an",
  "of",
  "to",
  "for",
  "in",
  "on",
  "is",
  "are",
  "be",
  "yes",
  "true",
  "prefers",
  "prefer",
  "preferred",
  "preference",
  "preferences",
  "pref",
  "likes",
  "like",
  "wants",
  "want",
  "style",
  "setting",
  "settings",
  "value",
  // Dimension words: "response length = short" says no more than "short
  // responses".
  "length",
  "level",
  "size",
  "amount",
  "type",
  "kind",
  "\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C",
  "\u043F\u0440\u0435\u0434\u043F\u043E\u0447\u0438\u0442\u0430\u0435\u0442",
  "\u043F\u0440\u0435\u0434\u043F\u043E\u0447\u0442\u0435\u043D\u0438\u0435",
  "\u0434\u0430"
]);
const NEGATION_WORDS = /* @__PURE__ */ new Set([
  "no",
  "not",
  "false",
  "never",
  "none",
  "off",
  "\u043D\u0435\u0442",
  "\u043D\u0435",
  "\u043D\u0438\u043A\u043E\u0433\u0434\u0430"
]);
const SYNONYMS = {
  answer: "reply",
  answers: "reply",
  response: "reply",
  responses: "reply",
  reply: "reply",
  replies: "reply",
  \u043E\u0442\u0432\u0435\u0442: "reply",
  \u043E\u0442\u0432\u0435\u0442\u044B: "reply",
  \u043E\u0442\u0432\u0435\u0442\u043E\u0432: "reply",
  short: "short",
  shorter: "short",
  brief: "short",
  concise: "short",
  terse: "short",
  \u043A\u0440\u0430\u0442\u043A\u0438\u0435: "short",
  \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0435: "short",
  \u043A\u0440\u0430\u0442\u043A\u043E: "short",
  \u043A\u043E\u0440\u043E\u0442\u043A\u043E: "short",
  long: "long",
  longer: "long",
  detailed: "long",
  verbose: "long",
  \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u044B\u0435: "long",
  \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E: "long",
  lang: "language",
  language: "language",
  \u044F\u0437\u044B\u043A: "language",
  tz: "timezone",
  timezone: "timezone"
};
function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function concepts(key, value) {
  const out = /* @__PURE__ */ new Set();
  for (const word of [...words(key.replace(/[_.-]+/g, " ")), ...words(value)]) {
    if (FILLER_WORDS.has(word) || NEGATION_WORDS.has(word)) continue;
    const synonym = SYNONYMS[word];
    if (synonym !== void 0) out.add(synonym);
    else if (word.length >= 2) out.add(word.length > 5 ? word.slice(0, 5) : word);
  }
  return out;
}
function negated(key, value) {
  return [...words(key.replace(/[_.-]+/g, " ")), ...words(value)].some(
    (w) => NEGATION_WORDS.has(w)
  );
}
function findDuplicateFact(existing, key, value) {
  const wanted = normaliseProfileValue(value);
  for (const fact of existing) {
    if (fact.key === key && normaliseProfileValue(fact.value) === wanted) {
      return { fact, kind: "same" };
    }
  }
  const nameKey = isNameProfileKey(key);
  const mine = concepts(key, value);
  const mineNegated = negated(key, value);
  for (const fact of existing) {
    if (fact.key === key) continue;
    if (nameKey) {
      if (isNameProfileKey(fact.key) && normaliseProfileValue(fact.value) === wanted) {
        return { fact, kind: "near" };
      }
      continue;
    }
    if (isNameProfileKey(fact.key)) continue;
    if (negated(fact.key, fact.value) !== mineNegated) continue;
    const theirs = concepts(fact.key, fact.value);
    if (mine.size < 2 || mine.size !== theirs.size) continue;
    if ([...mine].every((c) => theirs.has(c))) return { fact, kind: "near" };
  }
  return null;
}
export {
  findDuplicateFact,
  normaliseProfileValue
};
