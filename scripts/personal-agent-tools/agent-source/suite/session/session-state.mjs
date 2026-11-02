import {
  appendTurn
} from "./conversation-turn.mjs";
import { appendMacroTurnStart } from "./macro-turn-starts.mjs";
function isFailedSessionStatus(status) {
  return status === "failed" || status === "stalled";
}
function createEmptySessionState(params) {
  const now = Date.now();
  return {
    id: params.id,
    workingDir: params.workingDir,
    status: "pending",
    knownFacts: [],
    latestResult: null,
    loadedSkills: [],
    loadedTools: [],
    worldSnapshot: null,
    stepCount: 0,
    turnCount: 0,
    macroTurnStarts: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
    lastError: null,
    metadata: params.metadata ?? {}
  };
}
function appendFact(state, fact) {
  return {
    ...state,
    knownFacts: [...state.knownFacts, fact],
    updatedAt: Date.now()
  };
}
function recordLatestResult(state, result) {
  return { ...state, latestResult: result, updatedAt: Date.now() };
}
function recordLoadedSkill(state, entry) {
  const others = state.loadedSkills.filter((s) => s.name !== entry.name);
  return {
    ...state,
    loadedSkills: [...others, entry],
    updatedAt: Date.now()
  };
}
function recordLoadedTool(state, entry, cap) {
  const loadedAt = entry.loadedAt ?? Date.now();
  const normalized = {
    name: entry.name,
    summary: entry.summary,
    argsSchema: entry.argsSchema,
    ...entry.examples !== void 0 && entry.examples.length > 0 ? { examples: entry.examples } : {},
    source: entry.source,
    loadedAt
  };
  const without = state.loadedTools.filter((t) => t.name !== normalized.name);
  let next = [...without, normalized];
  const safeCap = Math.max(1, cap);
  while (next.length > safeCap) {
    const sorted = next.slice().sort((a, b) => a.loadedAt - b.loadedAt);
    const [, ...rest] = sorted;
    next = rest;
  }
  return { ...state, loadedTools: next, updatedAt: Date.now() };
}
function recordWorldSnapshot(state, snapshot) {
  return { ...state, worldSnapshot: snapshot, updatedAt: Date.now() };
}
function recordTurn(state, turn) {
  return {
    ...state,
    turns: appendTurn(state.turns, turn),
    updatedAt: Date.now()
  };
}
function rememberConversationPackStart(state, packStart) {
  const prev = state.conversationPackStart;
  if (packStart === null) {
    if (prev === void 0) return state;
    const { conversationPackStart: _dropped, ...rest } = state;
    return rest;
  }
  if (prev !== void 0 && prev.index === packStart.index && prev.at === packStart.at && prev.boundBy === packStart.boundBy) {
    return state;
  }
  return { ...state, conversationPackStart: packStart };
}
function incrementTurnCount(state) {
  return {
    ...state,
    turnCount: state.turnCount + 1,
    macroTurnStarts: appendMacroTurnStart(
      state.macroTurnStarts,
      state.turns.length
    ),
    updatedAt: Date.now()
  };
}
function stripEphemeral(state) {
  if (state.recalledNotes === void 0 && state.memoryIndex === void 0 && state.recalledLessons === void 0 && state.recalledProcedures === void 0) {
    return state;
  }
  const {
    recalledNotes: _r,
    memoryIndex: _m,
    recalledLessons: _l,
    recalledProcedures: _p,
    ...rest
  } = state;
  return rest;
}
export {
  appendFact,
  createEmptySessionState,
  incrementTurnCount,
  isFailedSessionStatus,
  recordLatestResult,
  recordLoadedSkill,
  recordLoadedTool,
  recordTurn,
  recordWorldSnapshot,
  rememberConversationPackStart,
  stripEphemeral
};
