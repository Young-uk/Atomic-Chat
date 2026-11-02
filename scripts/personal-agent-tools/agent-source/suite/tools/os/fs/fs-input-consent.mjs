import { REQUEST_FOLLOW_UP_MARKER } from "../../../prompt/request-section.mjs";
import {
  bareToken,
  replaceVerbReaches,
  requestNamesFile,
  SENTENCE_END
} from "./fs-input-words.mjs";
const AFFIRMATIVE_WORDS = /* @__PURE__ */ new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "k",
  "sure",
  "fine",
  "alright",
  "ahead",
  "proceed",
  "confirm",
  "confirmed",
  "approved",
  "\u0434\u0430",
  "\u0430\u0433\u0430",
  "\u0443\u0433\u0443",
  "\u043E\u043A",
  "\u043E\u043A\u0435\u0439",
  "\u0434\u0430\u0432\u0430\u0439",
  "\u043A\u043E\u043D\u0435\u0447\u043D\u043E",
  "\u043C\u043E\u0436\u043D\u043E",
  "\u0432\u0430\u043B\u044F\u0439",
  "\u0433\u043E",
  "\u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E"
]);
const AFFIRMATIVE_FILLER = /* @__PURE__ */ new Set([
  "please",
  "pls",
  "go",
  "do",
  "it",
  "that",
  "just",
  "and",
  "thanks",
  "thank",
  "you",
  "of",
  "course",
  "sounds",
  "good",
  "absolutely",
  "\u043F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430",
  "\u0434\u0435\u043B\u0430\u0439",
  "\u0441\u0434\u0435\u043B\u0430\u0439",
  "\u0442\u0430\u043A",
  "\u0441\u043F\u0430\u0441\u0438\u0431\u043E",
  "\u0440\u0430\u0437\u0443\u043C\u0435\u0435\u0442\u0441\u044F"
]);
const PLAIN_YES_MAX_WORDS = 8;
function isPlainYes(reply) {
  const words = reply.split(/\s+/).map(bareToken).filter((word) => word.length > 0);
  if (words.length === 0 || words.length > PLAIN_YES_MAX_WORDS) return false;
  let yes = false;
  for (const word of words) {
    if (AFFIRMATIVE_WORDS.has(word)) yes = true;
    else if (!AFFIRMATIVE_FILLER.has(word)) return false;
  }
  return yes;
}
function latestUserMessage(consent) {
  const at = consent.lastIndexOf(REQUEST_FOLLOW_UP_MARKER);
  return at === -1 ? consent : consent.slice(at + REQUEST_FOLLOW_UP_MARKER.length);
}
const TRAILING_WRAP = /["'`*_)\]»”]+$/u;
function questionSentences(reply) {
  const questions = [];
  let sentence = [];
  for (const word of reply.split(/\s+/)) {
    if (word.length === 0) continue;
    sentence.push(word);
    const end = word.replace(TRAILING_WRAP, "");
    if (!SENTENCE_END.test(end)) continue;
    if (end.endsWith("?")) questions.push(sentence);
    sentence = [];
  }
  return questions;
}
const FOLLOW_UP_POINTERS = /* @__PURE__ */ new Set([
  "it",
  "them",
  "file",
  "files",
  "\u0435\u0433\u043E",
  "\u0435\u0451",
  "\u0435\u0435",
  "\u0438\u0445",
  "\u0444\u0430\u0439\u043B",
  "\u0444\u0430\u0439\u043B\u044B"
]);
const FOLLOW_UP_DEMONSTRATIVES = /* @__PURE__ */ new Set([
  "that",
  "this",
  "these",
  "those",
  "\u044D\u0442\u043E\u0442",
  "\u044D\u0442\u043E",
  "\u044D\u0442\u0438"
]);
const DEMONSTRATIVE_NOUNS = /* @__PURE__ */ new Set([
  "file",
  "files",
  "one",
  "ones",
  "\u0444\u0430\u0439\u043B",
  "\u0444\u0430\u0439\u043B\u044B"
]);
function isPointer(word, next) {
  const bare = bareToken(word);
  if (FOLLOW_UP_POINTERS.has(bare)) return true;
  if (!FOLLOW_UP_DEMONSTRATIVES.has(bare)) return false;
  return next === void 0 || SENTENCE_END.test(word) || DEMONSTRATIVE_NOUNS.has(bareToken(next));
}
function followUpAsksToReplace(request) {
  const at = request.lastIndexOf(REQUEST_FOLLOW_UP_MARKER);
  if (at === -1) return false;
  const latest = request.slice(at + REQUEST_FOLLOW_UP_MARKER.length);
  return replaceVerbReaches(latest, isPointer);
}
function replyAsksToReplace(reply, name) {
  return questionSentences(reply).some(
    (words) => replaceVerbReaches(words.join(" "), (word) => requestNamesFile(word, name))
  );
}
function answersReplaceQuestion(consent, previousReply, name) {
  if (previousReply === void 0 || consent.trim().length === 0) return false;
  if (!replyAsksToReplace(previousReply, name)) return false;
  return isPlainYes(latestUserMessage(consent)) || followUpAsksToReplace(consent);
}
export {
  answersReplaceQuestion,
  followUpAsksToReplace,
  isPlainYes,
  latestUserMessage,
  questionSentences,
  replyAsksToReplace
};
