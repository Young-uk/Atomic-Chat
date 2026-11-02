const REWRITER_LINE_CHAR_CAP = 400;
const REWRITER_CURRENT_CHAR_CAP = 500;
const QUERY_REWRITER_STABLE_PREFIX = `You rewrite a user's follow-up message into a self-contained search query.

The recall system uses keyword matching (BM25) and embedding similarity over a personal memory store. Short referential follow-ups ("a \u0447\u0442\u043E \u0442\u0430\u043C \u0431\u044B\u043B\u043E?", "what about it?", "and the other one?") match almost nothing on their own, so we resolve the references against the recent conversation BEFORE running recall.

Rules:
- Inspect the recent history block and the current user message.
- Identify entities, topics, and intents the user is implicitly referring to (people, projects, decisions, code paths, places, time windows).
- Produce ONE concise query that contains those entities verbatim plus the user's intent. Keep it under 400 characters. Prefer the user's original language.
- The query is for retrieval, not for the user to read. Skip pleasantries, leading filler ("ok", "\u0442\u0430\u043A"), and rephrasing \u2014 keep nouns, names, IDs, technical terms.
- If the current message is already self-contained (clear nouns and intent, no pronouns or anaphora to resolve), echo it verbatim inside the envelope.
- If there is genuinely nothing to disambiguate against (history empty, no clear referent), output the literal token NONE.

Output exactly one line, in this envelope: <rewritten_query>...</rewritten_query>
No reasoning, no extra lines, no markdown.
`;
function buildRewriterPrompt(input) {
  const historyLines = input.history.map((turn) => {
    const tag = turn.role === "user" ? "USER" : "ASSISTANT";
    return `${tag}: ${clampLine(turn.text, REWRITER_LINE_CHAR_CAP)}`;
  }).join("\n");
  const tail = `
### history
${historyLines.length > 0 ? `${historyLines}
` : ""}
### current
USER: ${clampLine(input.currentMessage, REWRITER_CURRENT_CHAR_CAP)}

### output
`;
  return `${QUERY_REWRITER_STABLE_PREFIX}${tail}`;
}
function clampLine(raw, cap) {
  const normalised = raw.replace(/\s+/g, " ").trim();
  if (normalised.length <= cap) return normalised;
  return `${normalised.slice(0, cap - 1)}\u2026`;
}
export {
  QUERY_REWRITER_STABLE_PREFIX,
  REWRITER_CURRENT_CHAR_CAP,
  REWRITER_LINE_CHAR_CAP,
  buildRewriterPrompt
};
