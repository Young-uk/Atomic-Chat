import { isNameProfileKey } from "../profile-name-keys.mjs";
const PERSISTENCE_WORDS = /* @__PURE__ */ new Set([
  "remember",
  "always",
  "never",
  "default",
  "prefer",
  "prefers",
  "henceforth",
  "\u0437\u0430\u043F\u043E\u043C\u043D\u0438",
  "\u0437\u0430\u043F\u043E\u043C\u043D\u0438\u0442\u0435",
  "\u043F\u043E\u043C\u043D\u0438",
  "\u0432\u0441\u0435\u0433\u0434\u0430",
  "\u043D\u0438\u043A\u043E\u0433\u0434\u0430",
  "\u043E\u0442\u043D\u044B\u043D\u0435",
  "\u0432\u043F\u0440\u0435\u0434\u044C",
  "\u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E",
  "\u043F\u0440\u0435\u0434\u043F\u043E\u0447\u0438\u0442\u0430\u044E"
]);
const PERSISTENCE_PHRASES = [
  /\bfrom now on\b/,
  /\bgoing forward\b/,
  /\bnext time\b/,
  /\bevery time\b/,
  /\beach time\b/,
  /\bin (?:the )?future\b/,
  /\bby default\b/,
  /с этого момента/,
  /в следующий раз/,
  /каждый раз/
];
const PERSONAL_WORDS = /* @__PURE__ */ new Set([
  "my",
  "mine",
  "me",
  "i",
  "i'm",
  "im",
  "i've",
  "i'd",
  "i'll",
  "we",
  "our",
  "us",
  "\u044F",
  "\u043C\u0435\u043D\u044F",
  "\u043C\u043D\u0435",
  "\u043C\u043E\u0439",
  "\u043C\u043E\u044F",
  "\u043C\u043E\u0451",
  "\u043C\u043E\u0435",
  "\u043C\u043E\u0438",
  "\u043C\u044B",
  "\u043D\u0430\u0448",
  "\u043D\u0430\u0448\u0430",
  "\u043D\u0430\u0448\u0438"
]);
function lower(s) {
  return s.toLowerCase();
}
function wordTokens(text) {
  return lower(text).match(/[\p{L}\p{N}_'’]+/gu)?.map((t) => t.replace(/’/g, "'")) ?? [];
}
function hasPersistenceMarker(text) {
  const lowered = lower(text).replace(/\bnever\s*mind\b/g, " ");
  for (const token of wordTokens(lowered)) {
    if (PERSISTENCE_WORDS.has(token)) return true;
  }
  return PERSISTENCE_PHRASES.some((re) => re.test(lowered));
}
const MARKER_ONLY_FRAGMENT = /^(?:please\s+|пожалуйста\s+)?(?:remember(?: this| that)?|from now on|going forward|henceforth|by default|always|in (?:the )?future|запомни(?:те)?(?: это| что)?|помни|отныне|впредь|всегда|по умолчанию|с этого момента)\s*:?$/;
function isMarkerOnlyFragment(fragment) {
  return MARKER_ONLY_FRAGMENT.test(lower(fragment).replace(/\s+/g, " ").trim());
}
function hasPersonalMarker(text) {
  for (const token of wordTokens(text)) {
    if (PERSONAL_WORDS.has(token)) return true;
  }
  return false;
}
const STYLE_PREPOSITIONS = /* @__PURE__ */ new Set([
  "in",
  "with",
  "using",
  "as",
  "like",
  "to",
  "when",
  "for",
  "about",
  "on",
  "from",
  "by",
  "without",
  "after",
  "before",
  "if",
  "\u043D\u0430",
  "\u043F\u043E",
  "\u0432",
  "\u0441",
  "\u043A\u0430\u043A",
  "\u043A\u043E\u0433\u0434\u0430",
  "\u0431\u0435\u0437"
]);
const ECHO_WITH_QUALIFIER = /^(?:reply|respond|answer|say|output|print|return|type|write|repeat|echo|ответь|ответьте|отвечай|скажи|скажите|напиши|напишите|выведи|верни|повтори)(?:\s+back)?(?:\s+with)?(?:\s+(?:exactly|only|just|verbatim|precisely|literally|ровно|только|просто|строго|дословно))+\s*:?\s+(.+)$/;
const ECHO_BARE = /^(?:say|echo|repeat|скажи|повтори)\s*:?\s+(.+)$/;
const ECHO_PAYLOAD_TRAILER = /\s+(?:and nothing else|nothing else|only|exactly|verbatim|и больше ничего|только)$/;
const LITERAL_PAYLOAD_WORDS = /* @__PURE__ */ new Set([
  "ok",
  "okay",
  "yes",
  "no",
  "or",
  "pong",
  "ping",
  "ready",
  "done",
  "hi",
  "hello",
  "test",
  "true",
  "false",
  "\u043E\u043A",
  "\u0434\u0430",
  "\u043D\u0435\u0442",
  "\u0438\u043B\u0438",
  "\u0433\u043E\u0442\u043E\u0432\u043E",
  "\u043F\u0440\u0438\u0432\u0435\u0442",
  "\u043F\u043E\u043D\u0433",
  "\u043F\u0438\u043D\u0433"
]);
const FORMAT_PAYLOAD_WORDS = /* @__PURE__ */ new Set([
  "json",
  "jsonl",
  "yaml",
  "yml",
  "xml",
  "csv",
  "tsv",
  "html",
  "markdown",
  "md",
  "toml",
  "sql",
  "latex",
  "ascii"
]);
const TOOL_RESTRICTION = /^(?:(?:please\s+)?(?:do not|don't|dont|no need to|you don't need to|without)\s+(?:use|using|call|calling|run|running|invoke|invoking)?\s*(?:any\s+)?|no\s+)(?:tools?|tool calls?|functions?|function calls?|commands?)(?:\s+(?:for this|here|now|this time|in this reply|in your reply|for this reply|please))?$/;
const TOOL_RESTRICTION_RU = /^(?:не\s+(?:используй|используйте|вызывай|вызывайте|применяй|запускай)\s+(?:никакие\s+|никаких\s+)?|без\s+)(?:инструменты|инструментов|тулы|тулов|тулзы|функции|функций|команды|команд)$/;
const FORMAT_ONLY = /^(?:(?:no|without)\s+(?:explanations?|extra text|other text|additional text|markdown|formatting|punctuation|quotes|commentary|comments)|nothing else|and nothing else|only that|that's it|that is all|one word|in one word|без пояснений|без объяснений|ничего больше|больше ничего)$/;
const PING_FRAGMENTS = /* @__PURE__ */ new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "ping",
  "test",
  "testing",
  "test test",
  "just testing",
  "this is a test",
  "is this working",
  "are you there",
  "are you alive",
  "thanks",
  "thank you",
  "thx",
  "\u043F\u0440\u0438\u0432\u0435\u0442",
  "\u0437\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439",
  "\u0437\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435",
  "\u0442\u0435\u0441\u0442",
  "\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430",
  "\u043F\u0438\u043D\u0433",
  "\u0441\u043F\u0430\u0441\u0438\u0431\u043E"
]);
const LEADING_FILLER = /^(?:please|pls|plz|now|just|пожалуйста|просто|теперь)[,\s]+/;
const QUOTE_OPEN = /^["'`«“‘]/;
function splitFragments(text) {
  return text.split(/[.!?;\n]+|,\s+/).map((f) => f.trim()).filter((f) => f.length > 0);
}
function stripQuotes(s) {
  return s.replace(/^["'`«“‘]+|["'`»”’]+$/g, "").trim();
}
function isLiteralPayload(quoted, payload) {
  if (quoted) return true;
  const words = payload.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length > 0 && words.every((w) => FORMAT_PAYLOAD_WORDS.has(lower(w)))) {
    return false;
  }
  if (/[_\d]/.test(payload)) return true;
  const tokens = payload.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.some(
    (t) => t.length >= 2 && t === t.toUpperCase() && /\p{Lu}/u.test(t)
  )) {
    return true;
  }
  return tokens.length > 0 && tokens.every((t) => LITERAL_PAYLOAD_WORDS.has(lower(t)));
}
function classifyFragment(original) {
  let f = lower(original).replace(/’/g, "'").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i += 1) {
    const next = f.replace(LEADING_FILLER, "");
    if (next === f) break;
    f = next;
  }
  if (f.length === 0) return { kind: "ping" };
  if (PING_FRAGMENTS.has(f)) return { kind: "ping" };
  if (TOOL_RESTRICTION.test(f) || TOOL_RESTRICTION_RU.test(f)) {
    return { kind: "tool_restriction" };
  }
  if (FORMAT_ONLY.test(f)) return { kind: "format" };
  const echo = ECHO_WITH_QUALIFIER.exec(f) ?? ECHO_BARE.exec(f);
  if (!echo) return null;
  const rawPayload = echo[1].replace(ECHO_PAYLOAD_TRAILER, "").trim();
  const quoted = QUOTE_OPEN.test(rawPayload);
  const payloadLower = stripQuotes(rawPayload);
  const payloadWords = payloadLower.split(/\s+/).filter((w) => w.length > 0);
  if (payloadWords.length < 1 || payloadWords.length > 3 || payloadWords.some((w) => STYLE_PREPOSITIONS.has(w))) {
    return null;
  }
  const idx = lower(original).lastIndexOf(payloadLower);
  const payload = idx >= 0 ? original.slice(idx, idx + payloadLower.length) : payloadLower;
  if (!isLiteralPayload(quoted, payload)) return null;
  return { kind: "echo", payload };
}
function isTrivialReflectionWindow(userTexts) {
  for (const text of userTexts) {
    if (hasPersistenceMarker(text) || hasPersonalMarker(text)) return false;
    for (const fragment of splitFragments(text)) {
      if (classifyFragment(fragment) === null) return false;
    }
  }
  return true;
}
const NAMED_LEAD = /(?:^|[^\p{L}])(my name is|my name's|call me|remember me as|refer to me as|address me as|user is named|user is called|user is known as|user's name is|users name is|user name is|меня зовут|зови меня|называй меня)\s+([^\s,.;:!?]+)(?:\s+([^\s,.;:!?]+))?/giu;
const FIRST_PERSON_LEAD = /(?:^|[^\p{L}])(?:I am|I'm|Im|i am|i'm)\s+([^\s,.;:!?]+)(?:\s+(\p{Lu}[^\s,.;:!?]*))?(?=\s*(?:$|[,.;:!?)])|\s+and\b)/gu;
const USER_IS_LEAD = /(?:^|[^\p{L}])[Uu]ser is\s+(\p{Lu}[\p{L}'’]*)(?=\s*(?:$|[,.;:!?)])|\s+and\b)/gu;
const RU_USER_LEAD = /(?:^|[^\p{L}])(?:[Пп]ользовател(?:ь|я|ю|ем|е)|[Ии]мя пользователя)(?:\s+(?:зовут|по имени))?\s*[:—–-]?\s+([А-ЯЁ][а-яё]+)(?![\p{L}-])/gu;
const ATTRIBUTE_WORDS = /* @__PURE__ */ new Set([
  "afghan",
  "african",
  "albanian",
  "algerian",
  "american",
  "arab",
  "arabic",
  "argentine",
  "argentinian",
  "armenian",
  "asian",
  "australian",
  "austrian",
  "azerbaijani",
  "balkan",
  "bangladeshi",
  "belarusian",
  "belgian",
  "bilingual",
  "bolivian",
  "bosnian",
  "brazilian",
  "british",
  "buddhist",
  "bulgarian",
  "burmese",
  "cambodian",
  "canadian",
  "catholic",
  "caucasian",
  "chilean",
  "chinese",
  "colombian",
  "congolese",
  "croatian",
  "cuban",
  "cypriot",
  "czech",
  "danish",
  "dutch",
  "ecuadorian",
  "egyptian",
  "english",
  "estonian",
  "ethiopian",
  "european",
  "filipino",
  "finnish",
  "flemish",
  "french",
  "georgian",
  "german",
  "ghanaian",
  "greek",
  "hindu",
  "hispanic",
  "hungarian",
  "icelandic",
  "indian",
  "indonesian",
  "iranian",
  "iraqi",
  "irish",
  "israeli",
  "italian",
  "jamaican",
  "japanese",
  "jewish",
  "jordanian",
  "kazakh",
  "kenyan",
  "korean",
  "kurdish",
  "kyrgyz",
  "latin",
  "latina",
  "latino",
  "latvian",
  "lebanese",
  "lithuanian",
  "luxembourgish",
  "malaysian",
  "maltese",
  "mexican",
  "moldovan",
  "mongolian",
  "montenegrin",
  "moroccan",
  "multilingual",
  "muslim",
  "nepalese",
  "nepali",
  "nigerian",
  "nordic",
  "norwegian",
  "orthodox",
  "pakistani",
  "palestinian",
  "persian",
  "peruvian",
  "polish",
  "portuguese",
  "romanian",
  "russian",
  "saudi",
  "scandinavian",
  "scottish",
  "senegalese",
  "serbian",
  "singaporean",
  "slavic",
  "slovak",
  "slovenian",
  "spanish",
  "sudanese",
  "swedish",
  "swiss",
  "syrian",
  "taiwanese",
  "tajik",
  "thai",
  "tunisian",
  "turkish",
  "turkmen",
  "ukrainian",
  "uruguayan",
  "uzbek",
  "venezuelan",
  "vietnamese",
  "welsh"
]);
function isAttributeWord(word) {
  const lowered = lower(word);
  if (ATTRIBUTE_WORDS.has(lowered)) return true;
  if (lowered.length > 5 && lowered.endsWith("ish")) return true;
  return word.length >= 2 && /^\p{Lu}+$/u.test(word);
}
const NON_NAME_CAPITALISED = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "not",
  "also",
  "in",
  "at",
  "on",
  "from",
  "using",
  "working",
  "going",
  "trying",
  "looking",
  "currently",
  "still",
  "very",
  "so",
  "here",
  "back",
  "your",
  "you",
  "it",
  "this",
  "that",
  "fine",
  "ready",
  "done",
  "sorry"
]);
const PERSONA_END = String.raw`(?=\s*(?:$|[,.;:!?)]|and\b|but\b|who\b|that\b))`;
const ASSISTANT_PERSONA = [
  new RegExp(
    String.raw`\byou(?: are|'re) (?:my|a|an|the|our)\s+(?:personal\s+|ai\s+|helpful\s+|virtual\s+|local\s+)*(?:assistant|ai|agent|chatbot|bot)\b` + PERSONA_END,
    "i"
  ),
  new RegExp(
    String.raw`\bi(?: am|'m) (?:an?\s+|the\s+|your\s+)?(?:personal\s+|ai\s+|helpful\s+|virtual\s+)*(?:ai|assistant|language model|llm|chatbot|memory extractor)\b` + PERSONA_END,
    "i"
  ),
  /\bmemory extractor\b/i,
  // "As an AI, I …" at the start of a clause — not "works as an AI engineer".
  /(?:^|[.!?]\s+)as an ai(?: language model| assistant)?\s*,/i
];
const TOOL_MENTION = /\btool(?:s|ing)?\b|\btool[-_ ]?(?:use|usage|calls?)\b|инструмент/i;
const TOOL_AVOIDANCE = /\b(?:avoid|avoids|avoiding|not|no|never|without|don't|doesn't|instead|prefer|prefers|preferred|dislike|dislikes|disable|disabled|minimi[sz]e)\b|не\s|без\s/i;
const CYRILLIC_TO_LATIN = {
  \u0430: "a",
  \u0431: "b",
  \u0432: "v",
  \u0433: "g",
  \u0434: "d",
  \u0435: "e",
  \u0451: "e",
  \u0436: "zh",
  \u0437: "z",
  \u0438: "i",
  \u0439: "y",
  \u043A: "k",
  \u043B: "l",
  \u043C: "m",
  \u043D: "n",
  \u043E: "o",
  \u043F: "p",
  \u0440: "r",
  \u0441: "s",
  \u0442: "t",
  \u0443: "u",
  \u0444: "f",
  \u0445: "kh",
  \u0446: "ts",
  \u0447: "ch",
  \u0448: "sh",
  \u0449: "shch",
  \u044A: "",
  \u044B: "y",
  \u044C: "",
  \u044D: "e",
  \u044E: "yu",
  \u044F: "ya",
  \u0456: "i",
  \u0457: "yi",
  \u0454: "ye",
  \u0491: "g"
};
function transliterate(s) {
  let out = "";
  for (const ch of s) out += CYRILLIC_TO_LATIN[ch] ?? ch;
  return out;
}
function looseKey(word) {
  return transliterate(lower(word)).replace(/[^a-z0-9]/g, "").replace(/x/g, "ks").replace(/j/g, "y").replace(/w/g, "v").replace(/ph/g, "f").replace(/ia/g, "ya").replace(/^ye/, "e").replace(/^yu/, "u").replace(/(.)\1+/g, "$1");
}
const RU_CASE_ENDINGS = [
  "\u043E\u0439",
  "\u0435\u0439",
  "\u043E\u043C",
  "\u0435\u043C",
  "\u0430\u043C",
  "\u044F\u043C",
  "\u043E\u044E",
  "\u0435\u044E",
  "\u0443",
  "\u044E",
  "\u0435",
  "\u044B",
  "\u0438",
  "\u0430",
  "\u044F",
  "\u044C"
];
function cyrillicStems(token) {
  const lowered = lower(token);
  const out = [];
  for (const ending of RU_CASE_ENDINGS) {
    if (lowered.endsWith(ending) && lowered.length - ending.length >= 3) {
      out.push(lowered.slice(0, lowered.length - ending.length));
    }
  }
  return out;
}
function editDistance(a, b) {
  if (a === b) return 0;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}
const OTHER_SCRIPT = /(?![\p{Script=Latin}\p{Script=Cyrillic}])\p{L}/u;
const OTHER_SCRIPT_GLOBAL = /(?![\p{Script=Latin}\p{Script=Cyrillic}])\p{L}/gu;
const OTHER_SCRIPT_MIN_LETTERS = 3;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN_OR_CYRILLIC_GLOBAL = /[\p{Script=Latin}\p{Script=Cyrillic}]/gu;
const NAMING_HINT_WORDS = /* @__PURE__ */ new Set([
  "\u0437\u043E\u0432\u0443\u0442",
  "\u0437\u043E\u0432\u0438",
  "\u0437\u043E\u0432\u0438\u0442\u0435",
  "\u043D\u0430\u0437\u044B\u0432\u0430\u0439",
  "\u043D\u0430\u0437\u044B\u0432\u0430\u0439\u0442\u0435",
  "\u0437\u0432\u0430\u0442\u044C",
  "\u0438\u043C\u044F",
  "name",
  "named",
  "call"
]);
const RU_NAMING_LEADS_2 = /* @__PURE__ */ new Set([
  "\u0437\u043E\u0432\u0438 \u043C\u0435\u043D\u044F",
  "\u043D\u0430\u0437\u044B\u0432\u0430\u0439 \u043C\u0435\u043D\u044F",
  "\u043C\u0435\u043D\u044F \u0437\u043E\u0432\u0443\u0442",
  "\u0437\u0432\u0430\u0442\u044C \u043C\u0435\u043D\u044F",
  "\u043C\u043E\u0435 \u0438\u043C\u044F",
  "\u043C\u043E\u0451 \u0438\u043C\u044F"
]);
function followsRuNamingLead(tokens, i) {
  const prev1 = i >= 1 ? lower(tokens[i - 1]) : "";
  const prev2 = i >= 2 ? lower(tokens[i - 2]) : "";
  if (prev1 === "\u044F") return true;
  return RU_NAMING_LEADS_2.has(`${prev2} ${prev1}`);
}
function buildVocabulary(ctx) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (entry) => {
    if (entry.key.length === 0) return;
    const id = `${entry.raw}|${entry.key}|${entry.fuzzy}|${entry.cyrillic}`;
    if (seen.has(id)) return;
    seen.add(id);
    entries.push(entry);
  };
  let otherScriptLetters = 0;
  let comparableLetters = 0;
  const addText = (text) => {
    otherScriptLetters += text.match(OTHER_SCRIPT_GLOBAL)?.length ?? 0;
    comparableLetters += text.match(LATIN_OR_CYRILLIC_GLOBAL)?.length ?? 0;
    for (const sentence of text.split(/[.!?…\n]+/)) {
      const tokens = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];
      const namingSentence = tokens.length <= 2 || tokens.some((t) => NAMING_HINT_WORDS.has(lower(t)));
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        const cyrillic = CYRILLIC.test(token);
        const nameLike = /^\p{Lu}/u.test(token) && (i > 0 || namingSentence) || cyrillic && followsRuNamingLead(tokens, i);
        add({
          raw: lower(token),
          key: looseKey(token),
          fuzzy: nameLike,
          cyrillic: cyrillic && nameLike
        });
        if (cyrillic && nameLike) {
          for (const stem of cyrillicStems(token)) {
            add({ raw: stem, key: looseKey(stem), fuzzy: true, cyrillic: true });
          }
        }
      }
    }
  };
  for (const text of ctx.userTexts) addText(text);
  for (const text of ctx.nameEvidence ?? []) addText(text);
  return {
    entries,
    unverifiable: writesMostlyOtherScript({
      other: otherScriptLetters,
      comparable: comparableLetters
    })
  };
}
function countScriptLetters(texts) {
  let other = 0;
  let comparable = 0;
  for (const text of texts) {
    other += text.match(OTHER_SCRIPT_GLOBAL)?.length ?? 0;
    comparable += text.match(LATIN_OR_CYRILLIC_GLOBAL)?.length ?? 0;
  }
  return { other, comparable };
}
function writesMostlyOtherScript(counts) {
  return counts.other >= OTHER_SCRIPT_MIN_LETTERS && counts.other >= counts.comparable;
}
function isComparable(word, vocab) {
  if (OTHER_SCRIPT.test(word)) return false;
  return !vocab.unverifiable || CYRILLIC.test(word);
}
function isGrounded(word, vocab) {
  const raw = lower(word).replace(/[^\p{L}\p{N}]/gu, "");
  const key = looseKey(word);
  if (key.length === 0 || raw.length === 0) return true;
  const tolerance = key.length <= 5 ? 1 : 2;
  for (const entry of vocab.entries) {
    if (entry.raw === raw) return true;
    if (entry.key === key && (entry.fuzzy || key.length >= 5)) return true;
    if (entry.key.length >= 5 && key.startsWith(entry.key)) return true;
    if (!entry.fuzzy) continue;
    if (entry.cyrillic && entry.key.length >= 3 && commonPrefixLength(entry.key, key) >= Math.max(3, key.length - 2)) {
      return true;
    }
    if (key.length < 5) continue;
    if (entry.key.length < 3) continue;
    if (entry.key[0] !== key[0]) continue;
    if (Math.abs(entry.key.length - key.length) > tolerance) continue;
    if (editDistance(entry.key, key) <= tolerance) return true;
  }
  return false;
}
function startsUppercase(word) {
  return /^\p{Lu}/u.test(word);
}
function cleanWord(word) {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
function namePartsOf(raw) {
  const out = [];
  for (const part of raw.split(/[-‐–]/)) {
    const word = cleanWord(part);
    if (word.length < 2) continue;
    if (!startsUppercase(word)) continue;
    if (NON_NAME_CAPITALISED.has(lower(word))) continue;
    out.push(word);
  }
  return out;
}
function claimedNames(text) {
  const out = [];
  for (const match of text.matchAll(NAMED_LEAD)) {
    const first = match[2];
    if (!first || !startsUppercase(cleanWord(first))) continue;
    out.push(...namePartsOf(first));
    const second = match[3];
    if (second && startsUppercase(cleanWord(second))) out.push(...namePartsOf(second));
  }
  for (const match of text.matchAll(FIRST_PERSON_LEAD)) {
    const first = match[1];
    if (!first || !startsUppercase(cleanWord(first))) continue;
    out.push(...namePartsOf(first).filter((w) => !isAttributeWord(w)));
    if (match[2]) out.push(...namePartsOf(match[2]).filter((w) => !isAttributeWord(w)));
  }
  for (const match of text.matchAll(RU_USER_LEAD)) {
    const word = match[1] ?? "";
    if (word.length >= 2) out.push(word);
  }
  for (const match of text.matchAll(USER_IS_LEAD)) {
    const word = cleanWord(match[1] ?? "");
    if (word.length < 2 || isAttributeWord(word)) continue;
    if (NON_NAME_CAPITALISED.has(lower(word))) continue;
    out.push(word);
  }
  return out;
}
function nameValueWords(value) {
  return value.split(/[\s_-]+/).map(cleanWord).filter((w) => w.length >= 2 && /\p{L}/u.test(w));
}
function collectOneOffSignals(userTexts) {
  const payloadCounts = /* @__PURE__ */ new Map();
  let toolRestriction = false;
  for (const text of userTexts) {
    const fragments = splitFragments(text);
    for (let i = 0; i < fragments.length; i += 1) {
      const fragment = fragments[i];
      const probe = classifyFragment(fragment);
      if (!probe) continue;
      const previous = i > 0 ? fragments[i - 1] : null;
      const next = i + 1 < fragments.length ? fragments[i + 1] : null;
      if (hasPersistenceMarker(fragment) || previous !== null && isMarkerOnlyFragment(previous) || // ATO-201: the marker may come after it, too ("Отвечай только
      // JSON, всегда").
      next !== null && isMarkerOnlyFragment(next)) {
        continue;
      }
      if (probe.kind === "tool_restriction") toolRestriction = true;
      if (probe.kind === "echo" && probe.payload) {
        for (const token of probe.payload.match(/[\p{L}\p{N}_]+/gu) ?? []) {
          const distinctive = token.length >= 3 && /[_\d]/.test(token) || token.length >= 4 && token === token.toUpperCase() && /\p{Lu}/u.test(token);
          if (!distinctive) continue;
          const key = lower(token);
          payloadCounts.set(key, (payloadCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const payloadTokens = [];
  for (const [token, inEcho] of payloadCounts) {
    let total = 0;
    for (const text of userTexts) {
      for (const t of lower(text).match(/[\p{L}\p{N}_]+/gu) ?? []) {
        if (t === token) total += 1;
      }
    }
    if (total <= inEcho) payloadTokens.push(token);
  }
  return { payloadTokens, toolRestriction };
}
function containsToken(text, token) {
  const tokens = lower(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.includes(token);
}
function judge(rawText, nameWords, vocab, oneOff, userTextLower) {
  const text = rawText.replace(/’/g, "'");
  for (const re of ASSISTANT_PERSONA) {
    const hit = re.exec(text);
    if (hit && !userTextLower.includes(lower(hit[0]).trim())) return "assistant_persona";
  }
  for (const word of [...nameWords, ...claimedNames(text)]) {
    if (!isComparable(word, vocab)) continue;
    if (!isGrounded(word, vocab)) return "ungrounded_identity";
  }
  for (const token of oneOff.payloadTokens) {
    if (containsToken(text, token)) return "one_off_payload";
  }
  if (oneOff.toolRestriction && TOOL_MENTION.test(text) && TOOL_AVOIDANCE.test(text)) {
    return "one_off_tool_restriction";
  }
  return null;
}
function filterUngroundedReflection(parsed, ctx) {
  const vocab = buildVocabulary(ctx);
  const oneOff = collectOneOffSignals(ctx.userTexts);
  const userTextLower = lower(ctx.userTexts.join("\n").replace(/’/g, "'"));
  const dropped = [];
  const facts = [];
  for (const fact of parsed.facts) {
    const text = `${fact.key.replace(/_/g, " ")} ${fact.value}`;
    const nameWords = isNameProfileKey(fact.key) ? nameValueWords(fact.value) : [];
    const reason = judge(text, nameWords, vocab, oneOff, userTextLower);
    if (reason) {
      dropped.push({ kind: "fact", reason, text: `${fact.key}=${fact.value}` });
      continue;
    }
    facts.push(fact);
  }
  const notes = [];
  for (const note of parsed.notes) {
    const reason = judge(note.body, [], vocab, oneOff, userTextLower);
    if (reason) {
      dropped.push({ kind: "note", reason, text: note.body });
      continue;
    }
    notes.push(note);
  }
  return { facts, notes, dropped };
}
const CONFIRMATION_WORDS = /* @__PURE__ */ new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "correct",
  "right",
  "exactly",
  "sure",
  "indeed",
  "ok",
  "okay",
  "\u0434\u0430",
  "\u0430\u0433\u0430",
  "\u0443\u0433\u0443",
  "\u0432\u0435\u0440\u043D\u043E",
  "\u0442\u043E\u0447\u043D\u043E",
  "\u0438\u043C\u0435\u043D\u043D\u043E",
  "\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E",
  "\u043A\u043E\u043D\u0435\u0447\u043D\u043E",
  "\u043E\u043A",
  "\u0442\u0430\u043A"
]);
const CONFIRMATION_FILLER = /* @__PURE__ */ new Set([
  "that's",
  "thats",
  "that",
  "it",
  "it's",
  "its",
  "is",
  "me",
  "i",
  "am",
  "\u044D\u0442\u043E",
  "\u044F",
  "\u0432\u0441\u0451",
  "\u0432\u0441\u0435"
]);
function isBareConfirmation(text) {
  const tokens = wordTokens(text);
  if (tokens.length === 0 || tokens.length > 5) return false;
  let yes = false;
  for (const token of tokens) {
    if (CONFIRMATION_WORDS.has(token)) yes = true;
    else if (!CONFIRMATION_FILLER.has(token)) return false;
  }
  return yes;
}
const NAMING_QUESTION = /\b(?:name|call you|address you)\b|зовут|звать|имя|называть|обращаться/i;
function namingQuestionsOf(reply) {
  const out = [];
  for (const match of reply.matchAll(/[^.!?\n]*\?/g)) {
    const question = match[0].trim();
    if (NAMING_QUESTION.test(question)) out.push(question);
  }
  return out;
}
function ungroundedClaimedNames(text, texts) {
  const vocab = buildVocabulary({ userTexts: texts });
  const out = [];
  for (const word of claimedNames(text.replace(/’/g, "'"))) {
    if (!isComparable(word, vocab)) continue;
    if (!isGrounded(word, vocab) && !out.includes(word)) out.push(word);
  }
  return out;
}
function nameGroundingIn(value, texts, options = {}) {
  const built = buildVocabulary({ userTexts: texts });
  const vocab = options.letters !== void 0 ? { ...built, unverifiable: writesMostlyOtherScript(options.letters) } : built;
  const words = nameValueWords(value);
  if (words.length === 0) return "unverifiable";
  let unverifiable = false;
  for (const word of words) {
    if (!isComparable(word, vocab)) {
      unverifiable = true;
      continue;
    }
    if (!isGrounded(word, vocab)) return "ungrounded";
  }
  return unverifiable ? "unverifiable" : "grounded";
}
export {
  countScriptLetters,
  filterUngroundedReflection,
  isBareConfirmation,
  isTrivialReflectionWindow,
  nameGroundingIn,
  namingQuestionsOf,
  ungroundedClaimedNames
};
