const DEFAULT_REWRITER_EXEMPLARS = [
  // referential follow-ups
  "what about that one",
  "can you say more",
  "and the other thing",
  "tell me more about it",
  "the same as before",
  "continue with that",
  "what does it mean",
  "why is that",
  "how about the rest",
  "more details please",
  "and after that",
  "what else",
  // temporal / multi-hop (LoCoMo-style — long but not self-contained for recall)
  "when did that happen",
  "when did she first mention it",
  "what year was the wedding",
  "who was at the conference",
  "how long ago did they meet",
  "what happened before the trip",
  "before that what did she say"
];
export {
  DEFAULT_REWRITER_EXEMPLARS
};
