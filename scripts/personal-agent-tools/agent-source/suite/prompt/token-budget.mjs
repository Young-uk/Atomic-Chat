function estimateTokens(text) {
  if (text.length === 0) return 0;
  return estimateTokensFromCounts(text.length, text.trim().split(/\s+/).length);
}
function estimateTokensFromCounts(chars, words) {
  if (chars === 0) return 0;
  return Math.max(Math.ceil(chars / 3.6), Math.ceil(words * 1.4));
}
const SESSION_SECTIONS_CAP_AUTO = 0;
const SESSION_SECTIONS_BUDGET_SHARE = 0.15;
function defaultBudget(total, caps = {}) {
  return {
    total,
    stablePrefix: Math.floor(total * 0.35),
    // `||`, not `??`: `SESSION_SECTIONS_CAP_AUTO` is `0`, and a caller
    // that passes the sentinel through is asking for the share. Under
    // `??` it would reach `truncateToTokens(text, 0)` and empty both
    // sections — the opposite of what the sentinel means.
    session: caps.session || Math.floor(total * SESSION_SECTIONS_BUDGET_SHARE),
    worldSnapshot: caps.worldSnapshot ?? Math.floor(total * 0.15),
    conversation: caps.conversation ?? Math.floor(total * 0.35)
  };
}
const CONVERSATION_CAP_SAFETY_MARGIN = 512;
const AGENT_FIXED_PROMPT_TOKENS = 8e3;
const REPLY_RESERVE_MAX_WINDOW_SHARE = 0.5;
const SMALL_WINDOW_PROMPT_ROOM = 16384;
const SMALL_WINDOW_REPLY_SHARE = 0.25;
const MIN_SMALL_WINDOW_REPLY_RESERVE = 1024;
function effectiveReplyReserve(completionMaxTokens, contextWindow) {
  if (!Number.isFinite(completionMaxTokens) || completionMaxTokens <= 0) {
    return 0;
  }
  if (!contextWindow || contextWindow <= 0) return completionMaxTokens;
  const smallWindowCap = Math.max(
    MIN_SMALL_WINDOW_REPLY_RESERVE,
    Math.floor(contextWindow * SMALL_WINDOW_REPLY_SHARE),
    contextWindow - SMALL_WINDOW_PROMPT_ROOM
  );
  return Math.min(
    completionMaxTokens,
    Math.floor(contextWindow * REPLY_RESERVE_MAX_WINDOW_SHARE),
    smallWindowCap
  );
}
function minUsableContextWindow(completionMaxTokens, contextWindow) {
  return AGENT_FIXED_PROMPT_TOKENS + (contextWindow ? effectiveReplyReserve(completionMaxTokens, contextWindow) : completionMaxTokens) + CONVERSATION_CAP_SAFETY_MARGIN;
}
const CONVERSATION_CAP_FLOOR = 512;
const CONVERSATION_CAP_AUTO = 0;
const CONVERSATION_CAP_AUTO_FALLBACK = 64e3;
function computeEffectiveConversationCap(input) {
  if (!input.contextWindow || input.contextWindow <= 0) {
    return Math.max(CONVERSATION_CAP_FLOOR, input.configuredCap);
  }
  const available = input.contextWindow - input.stablePrefixTokens - input.sessionTokens - input.worldSnapshotTokens - (input.profileTokens ?? 0) - (input.recalledTokens ?? 0) - (input.memoryIndexTokens ?? 0) - (input.lessonsTokens ?? 0) - (input.proceduresTokens ?? 0) - (input.loadedToolsTokens ?? 0) - effectiveReplyReserve(input.completionMaxTokens, input.contextWindow) - CONVERSATION_CAP_SAFETY_MARGIN;
  if (input.autoFill) return Math.max(CONVERSATION_CAP_FLOOR, available);
  return Math.max(
    CONVERSATION_CAP_FLOOR,
    Math.min(input.configuredCap, available)
  );
}
function checkBudget(sections, limits) {
  const stablePrefix = estimateTokens(sections.stablePrefix);
  const loadedSkills = estimateTokens(sections.loadedSkills);
  const sessionFacts = estimateTokens(sections.sessionFacts);
  const worldSnapshot = estimateTokens(sections.worldSnapshot);
  const conversation = estimateTokens(sections.conversation);
  const sessionForLimit = loadedSkills + sessionFacts;
  const total = stablePrefix + sessionForLimit + worldSnapshot + conversation;
  return {
    ok: total <= limits.total,
    exceededBy: Math.max(0, total - limits.total),
    perSection: {
      stablePrefix,
      loadedSkills,
      sessionFacts,
      worldSnapshot,
      conversation,
      total
    }
  };
}
function truncateToTokens(text, maxTokens) {
  if (maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  let low = 0;
  let high = text.length;
  let best = "";
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const candidate = text.slice(0, mid);
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const marker = "\n\u2026 [truncated]";
  if (best.length > marker.length + 1) {
    return best.slice(0, -marker.length) + marker;
  }
  return best;
}
export {
  AGENT_FIXED_PROMPT_TOKENS,
  CONVERSATION_CAP_AUTO,
  CONVERSATION_CAP_AUTO_FALLBACK,
  CONVERSATION_CAP_FLOOR,
  CONVERSATION_CAP_SAFETY_MARGIN,
  MIN_SMALL_WINDOW_REPLY_RESERVE,
  REPLY_RESERVE_MAX_WINDOW_SHARE,
  SESSION_SECTIONS_BUDGET_SHARE,
  SESSION_SECTIONS_CAP_AUTO,
  SMALL_WINDOW_PROMPT_ROOM,
  SMALL_WINDOW_REPLY_SHARE,
  checkBudget,
  computeEffectiveConversationCap,
  defaultBudget,
  effectiveReplyReserve,
  estimateTokens,
  estimateTokensFromCounts,
  minUsableContextWindow,
  truncateToTokens
};
