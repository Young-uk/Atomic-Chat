function isReferentialMessage(message, historyTurnCount) {
  if (historyTurnCount <= 0) return false;
  const normalised = message.trim().toLowerCase();
  if (normalised.length === 0) return false;
  const words = normalised.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  if (wordCount <= SHORT_MESSAGE_WORD_THRESHOLD && !hasQuestionWord(words)) {
    return true;
  }
  if (hasPronoun(words)) return true;
  if (hasConjunctionStarter(words[0] ?? "")) return true;
  return false;
}
const SHORT_MESSAGE_WORD_THRESHOLD = 5;
const PRONOUN_ALLOWLIST = /* @__PURE__ */ new Set([
  // en
  "it",
  "that",
  "they",
  "them",
  "those",
  "this",
  "these",
  "same",
  "more",
  // ru
  "\u043E\u043D",
  "\u043E\u043D\u0430",
  "\u043E\u043D\u043E",
  "\u043E\u043D\u0438",
  "\u044D\u0442\u043E",
  "\u0442\u043E",
  "\u0442\u0430\u043A\u043E\u0439",
  "\u0442\u0430\u043A\u0430\u044F",
  "\u0442\u0430\u043A\u0438\u0435",
  "\u0435\u0449\u0451",
  // es
  "eso",
  "esto",
  "ese",
  "esa",
  "\xE9l",
  "ella",
  "ellos",
  "m\xE1s",
  // de
  "das",
  "es",
  "sie",
  "er",
  "die",
  "jene",
  "mehr",
  // fr
  "\xE7a",
  "cela",
  "il",
  "elle",
  "ils",
  "celui",
  "plus",
  // pt
  "isso",
  "esse",
  "ele",
  "ela",
  "eles",
  "mais",
  // it
  "ci\xF2",
  "esso",
  "lui",
  "lei",
  "loro",
  "pi\xF9",
  // nl
  "dat",
  "het",
  "hij",
  "zij",
  "ze",
  "deze",
  "meer",
  // pl (omit bare "to" — collides with English preposition "to")
  "tamto",
  "tego",
  "temu",
  "on",
  "ona",
  "oni",
  "wi\u0119cej",
  // tr
  "bu",
  "\u015Fu",
  "o",
  "onlar",
  "daha",
  // ar
  "\u0630\u0644\u0643",
  "\u0647\u0630\u0627",
  "\u0647\u0648",
  "\u0647\u064A",
  "\u0647\u0645",
  "\u0623\u0643\u062B\u0631",
  // he
  "\u05D6\u05D4",
  "\u05D6\u05D5",
  "\u05D4\u05D5\u05D0",
  "\u05D4\u05D9\u05D0",
  "\u05D4\u05DD",
  "\u05D9\u05D5\u05EA\u05E8",
  // hi
  "\u092F\u0939",
  "\u0935\u0939",
  "\u0909\u0938\u0947",
  "\u0909\u0928\u094D\u0939\u0947\u0902",
  // vi
  "\u0111\xF3",
  "n\xE0y",
  "anh",
  "c\xF4",
  "h\u1ECD",
  "h\u01A1n",
  // id
  "itu",
  "ini",
  "dia",
  "mereka",
  "lagi",
  // ko
  "\uADF8",
  "\uC800",
  "\uC774",
  "\uB354"
]);
const CONJUNCTION_STARTERS = /* @__PURE__ */ new Set([
  // en
  "and",
  "but",
  "also",
  // ru
  "\u0430",
  "\u0438",
  "\u043D\u043E",
  "\u0435\u0449\u0451",
  "\u0438\u043B\u0438",
  // es
  "y",
  "pero",
  "tambi\xE9n",
  // de
  "und",
  "aber",
  "auch",
  // fr
  "et",
  "mais",
  "aussi",
  // pt
  "e",
  "mas",
  "tamb\xE9m",
  // it
  "ma",
  "anche",
  // nl
  "en",
  "maar",
  "ook",
  // pl
  "ale",
  "te\u017C",
  // tr
  "ve",
  "ama",
  "da",
  // ar
  "\u0648",
  "\u0644\u0643\u0646",
  "\u0623\u064A\u0636\u0627",
  // he
  "\u05D5",
  "\u05D0\u05D1\u05DC",
  "\u05D2\u05DD",
  // hi
  "\u0914\u0930",
  "\u0932\u0947\u0915\u093F\u0928",
  "\u092D\u0940",
  // vi
  "v\xE0",
  "nh\u01B0ng",
  "c\u0169ng",
  // id
  "dan",
  "tapi",
  "juga",
  // ko
  "\uADF8\uB9AC\uACE0",
  "\uD558\uC9C0\uB9CC",
  "\uB610"
]);
const QUESTION_WORDS = /* @__PURE__ */ new Set([
  // en
  "what",
  "when",
  "where",
  "why",
  "how",
  "who",
  "which",
  // ru
  "\u0447\u0442\u043E",
  "\u043A\u043E\u0433\u0434\u0430",
  "\u0433\u0434\u0435",
  "\u043F\u043E\u0447\u0435\u043C\u0443",
  "\u0437\u0430\u0447\u0435\u043C",
  "\u043A\u0430\u043A",
  "\u043A\u0442\u043E",
  "\u043A\u0430\u043A\u043E\u0439",
  "\u043A\u0430\u043A\u0430\u044F",
  "\u043A\u0430\u043A\u0438\u0435",
  // es
  "qu\xE9",
  "d\xF3nde",
  "cu\xE1ndo",
  "c\xF3mo",
  "qui\xE9n",
  "cu\xE1l",
  "por",
  // de
  "was",
  "wo",
  "wann",
  "wie",
  "warum",
  "wer",
  "welche",
  // fr
  "que",
  "o\xF9",
  "quand",
  "comment",
  "pourquoi",
  "qui",
  "quel",
  // pt
  "onde",
  "porqu\xEA",
  "quem",
  "qual",
  // it
  "che",
  "dove",
  "quando",
  "come",
  "perch\xE9",
  "chi",
  "quale",
  // nl
  "wat",
  "waar",
  "wanneer",
  "hoe",
  "waarom",
  "wie",
  "welk",
  // pl
  "co",
  "gdzie",
  "kiedy",
  "jak",
  "dlaczego",
  "kto",
  "kt\xF3ry",
  // tr
  "ne",
  "nerede",
  "nas\u0131l",
  "neden",
  "kim",
  "hangi",
  // ar
  "\u0645\u0627",
  "\u0645\u0627\u0630\u0627",
  "\u0623\u064A\u0646",
  "\u0645\u062A\u0649",
  "\u0643\u064A\u0641",
  "\u0644\u0645\u0627\u0630\u0627",
  "\u0645\u0646",
  "\u0623\u064A",
  // he
  "\u05DE\u05D4",
  "\u05D0\u05D9\u05E4\u05D4",
  "\u05DE\u05EA\u05D9",
  "\u05D0\u05D9\u05DA",
  "\u05DC\u05DE\u05D4",
  "\u05DE\u05D9",
  "\u05D0\u05D9\u05D6\u05D4",
  // hi
  "\u0915\u094D\u092F\u093E",
  "\u0915\u0939\u093E\u0901",
  "\u0915\u092C",
  "\u0915\u0948\u0938\u0947",
  "\u0915\u094D\u092F\u094B\u0902",
  "\u0915\u094C\u0928",
  "\u0915\u094C\u0928\u0938\u093E",
  // vi
  "g\xEC",
  "\u0111\xE2u",
  "sao",
  "t\u1EA1i",
  "ai",
  "n\xE0o",
  // id
  "apa",
  "di",
  "kapan",
  "bagaimana",
  "mengapa",
  "siapa",
  "yang",
  // ko
  "\uBB50",
  "\uC5B4\uB514",
  "\uC5B8\uC81C",
  "\uC5B4\uB5BB\uAC8C",
  "\uC65C",
  "\uB204\uAC00",
  "\uC5B4\uB290"
]);
function hasQuestionWord(words) {
  for (const word of words) {
    if (QUESTION_WORDS.has(stripPunctuation(word))) return true;
  }
  return false;
}
function hasPronoun(words) {
  for (const word of words) {
    if (PRONOUN_ALLOWLIST.has(stripPunctuation(word))) return true;
  }
  return false;
}
function hasConjunctionStarter(first) {
  return CONJUNCTION_STARTERS.has(stripPunctuation(first));
}
function stripPunctuation(word) {
  return word.replace(/^[.,!?;:"'`(]+|[.,!?;:"'`)]+$/g, "");
}
export {
  SHORT_MESSAGE_WORD_THRESHOLD,
  isReferentialMessage
};
