import { createHash } from "node:crypto";
const REWRITE_MEMO_MAX_SESSIONS = 256;
function createRewriterAwareMemoryContextProvider(opts) {
  const memo = /* @__PURE__ */ new Map();
  const remember = (sessionId, entry) => {
    memo.delete(sessionId);
    memo.set(sessionId, entry);
    if (memo.size > REWRITE_MEMO_MAX_SESSIONS) {
      const oldest = memo.keys().next().value;
      if (oldest !== void 0) memo.delete(oldest);
    }
  };
  const rewriteOncePerTurn = async (input, userMessage) => {
    const history = sliceHistoryForRewriter(
      input.recentTurns ?? [],
      opts.historyTurns
    );
    const key = rewriteKey(userMessage, history);
    const remembered = memo.get(input.sessionId);
    if (remembered !== void 0 && remembered.key === key) {
      remember(input.sessionId, remembered);
      return remembered.query;
    }
    const query = await opts.rewriter.maybeRewrite({
      sessionId: input.sessionId,
      userMessage,
      history,
      signal: input.signal
    });
    if (!input.signal.aborted) {
      remember(input.sessionId, { key, query });
    }
    return query;
  };
  return {
    async buildMemoryContext(input) {
      const userMessage = input.userMessage;
      if (userMessage === null || userMessage.length === 0) {
        return opts.inner.buildMemoryContext(input);
      }
      const rewritten = await rewriteOncePerTurn(input, userMessage);
      if (rewritten === userMessage) {
        return opts.inner.buildMemoryContext(input);
      }
      return opts.inner.buildMemoryContext({
        ...input,
        userMessage: rewritten
      });
    }
  };
}
function rewriteKey(userMessage, history) {
  return createHash("sha256").update(
    JSON.stringify([userMessage, history.map((row) => [row.role, row.text])])
  ).digest("hex");
}
function sliceHistoryForRewriter(turns, historyTurns) {
  if (historyTurns <= 0 || turns.length === 0) return [];
  const max = historyTurns * 2;
  return turns.length > max ? turns.slice(turns.length - max) : turns;
}
export {
  REWRITE_MEMO_MAX_SESSIONS,
  createRewriterAwareMemoryContextProvider
};
