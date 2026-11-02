import { estimateTokens } from "../prompt/token-budget.mjs";
function isFinalReplyTurn(turn) {
  return turn?.kind === "assistant_reply" && turn.progressNote !== true;
}
const STOPPED_TURN_MARKER_TEXT = "(stopped by the user before this turn finished: the request above was not completed. Do not continue it or come back to it unless the user asks for it again. Anything already done before the stop stays done.)";
function stoppedTurnMarker(at = Date.now()) {
  return {
    kind: "assistant_reply",
    text: STOPPED_TURN_MARKER_TEXT,
    stopped: true,
    at
  };
}
function isStoppedTurnMarker(turn) {
  return turn?.kind === "assistant_reply" && turn.stopped === true;
}
function userTurn(text, at = Date.now()) {
  return { kind: "user", text, at };
}
function steeredUserTurn(text, at = Date.now()) {
  return { kind: "user", text, steered: true, at };
}
function assistantToolCallTurn(params) {
  let turn = {
    kind: "assistant_tool_call",
    tool: params.tool,
    args: params.args,
    at: params.at ?? Date.now()
  };
  if (params.reasoning !== void 0 && params.reasoning.length > 0) {
    turn = { ...turn, reasoning: params.reasoning };
  }
  return turn;
}
function toolResultTurn(params) {
  let turn = {
    kind: "tool_result",
    tool: params.tool,
    status: params.status,
    summary: params.summary,
    at: params.at ?? Date.now()
  };
  if (params.truncated) turn = { ...turn, truncated: true };
  if (params.approvals !== void 0 && params.approvals.length > 0) {
    turn = { ...turn, approvals: [...params.approvals] };
  }
  if (params.read !== void 0) turn = { ...turn, read: { ...params.read } };
  return turn;
}
function assistantReplyTurn(text, atOrOptions = {}) {
  const options = typeof atOrOptions === "number" ? { at: atOrOptions } : atOrOptions;
  const at = options.at ?? Date.now();
  let turn = { kind: "assistant_reply", text, at };
  if (options.reasoning !== void 0 && options.reasoning.length > 0) {
    turn = { ...turn, reasoning: options.reasoning };
  }
  if (options.attachments !== void 0 && options.attachments.length > 0) {
    turn = { ...turn, attachments: [...options.attachments] };
  }
  if (options.progressNote === true) {
    turn = { ...turn, progressNote: true };
  }
  return turn;
}
const TOOL_RESULT_RENDER_CAP_CHARS = 8e3;
const GOG_TOOL_RESULT_RENDER_CAP_CHARS = 16e3;
const TOOLS_FULL_BODY_WHEN_FRESH = /* @__PURE__ */ new Set([
  "os.http.request",
  // The listing tools (see src/compressor/listing-caps.ts). Their
  // summaries are an ordered list of rows: the model needs the rows on
  // the turn it is choosing a commit, a PR, a branch, a process or a
  // tab from, and a header plus the newest few is enough afterwards
  // for "what did I look at?". Without this entry a wide listing —
  // `os.proc.list` at its default `limit` runs to the full 8 000
  // chars, ~2 000 tokens — would sit in `### conversation` at that
  // size for the rest of the session; with it, that width is paid for
  // once and the standing cost drops to TOOL_RESULT_HISTORY_CAP_CHARS,
  // the same 400 chars these results cost before the caps changed.
  // `os.shell.run` is deliberately absent: its `{"jobs": true}` form
  // is a listing, but the tool's other forms are not, and its render
  // budget is decided below.
  "os.git.log",
  "os.git.status",
  "os.git.branch",
  "os.proc.list",
  "os.window.list",
  "browser.tabs",
  "github.pr.list",
  "github.issue.list"
]);
const TOOL_RESULT_HISTORY_CAP_CHARS = 400;
function renderTurnForPrompt(turn, options = {}) {
  switch (turn.kind) {
    case "user":
      return `user: ${turn.text}`;
    case "assistant_tool_call": {
      const argsJson = JSON.stringify(turn.args);
      return `assistant_tool_call: ${turn.tool} ${argsJson}`;
    }
    case "tool_result": {
      const prefix = `tool_result[${turn.tool} ${turn.status}]`;
      const stub = readRepeatStub(turn, options);
      if (stub !== null) return `${prefix}: ${stub}`;
      const body = renderToolResultBody(turn, options);
      return `${prefix}: ${body}${turn.truncated ? " (truncated)" : ""}`;
    }
    case "assistant_reply":
      return turn.attachments !== void 0 && turn.attachments.length > 0 ? `assistant: ${turn.text} (attached: ${turn.attachments.join(", ")})` : `assistant: ${turn.text}`;
  }
}
function renderToolResultBody(turn, options) {
  const stub = readRepeatStub(turn, options);
  if (stub !== null) return stub;
  if (isGogShellResult(turn)) {
    if (options.inCurrentMacroTurn === true)
      return capSummary(turn.summary, GOG_TOOL_RESULT_RENDER_CAP_CHARS);
  } else if (turn.tool === "os.shell.run") {
    return capSummaryToTail(
      turn.summary,
      options.inCurrentMacroTurn === true ? TOOL_RESULT_RENDER_CAP_CHARS : TOOL_RESULT_HISTORY_CAP_CHARS
    );
  }
  if (TOOLS_FULL_BODY_WHEN_FRESH.has(turn.tool)) {
    if (options.inCurrentMacroTurn === true) return turn.summary;
    return capSummary(turn.summary, TOOL_RESULT_HISTORY_CAP_CHARS);
  }
  if (turn.tool === "fusion.delegate" && options.inCurrentMacroTurn === true) {
    return turn.summary;
  }
  if (turn.tool === "os.fs.read") {
    return capReadSummary(
      turn.summary,
      TOOL_RESULT_RENDER_CAP_CHARS,
      options.readStartLine
    );
  }
  return capSummary(turn.summary, TOOL_RESULT_RENDER_CAP_CHARS);
}
function readRepeatStub(turn, options) {
  const ref = options.readRepeat;
  const read = turn.read;
  if (ref === void 0 || read === void 0 || turn.tool !== "os.fs.read") {
    return null;
  }
  const lines = read.endLine - read.startLine + 1;
  const where = ref.resultsBack <= 1 ? "the os.fs.read result just above" : `the os.fs.read result ${ref.resultsBack} tool results above`;
  const stub = `[unchanged since your earlier read: same ${lines} lines (${read.startLine}-${read.endLine}), identical text \u2014 see ${where}; not repeated here]`;
  return stub.length < turn.summary.length ? stub : null;
}
function findReadRepeats(turns) {
  const previous = new Array(turns.length).fill(-1);
  const latest = /* @__PURE__ */ new Map();
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn?.kind !== "tool_result" || turn.tool !== "os.fs.read" || turn.status !== "ok" || turn.read === void 0 || turn.read.startLine < 1) {
      continue;
    }
    const key = readIdentityKey(turn.read);
    const before = latest.get(key);
    if (before !== void 0) {
      const earlier = turns[before];
      if (earlier?.kind === "tool_result" && earlier.summary === turn.summary) {
        previous[i] = before;
      }
    }
    latest.set(key, i);
  }
  return previous;
}
function readRepeatRefs(turns, previous = findReadRepeats(turns)) {
  const refs = new Array(turns.length);
  const origin = new Array(turns.length);
  const resultsBefore = new Array(turns.length);
  let results = 0;
  for (let i = 0; i < turns.length; i += 1) {
    resultsBefore[i] = results;
    if (turns[i]?.kind === "tool_result") results += 1;
    const prev = previous[i] ?? -1;
    origin[i] = prev === -1 ? i : origin[prev] ?? prev;
    if (prev !== -1) {
      refs[i] = {
        resultsBack: resultsBefore[i] - resultsBefore[origin[i]]
      };
    }
  }
  return refs;
}
function readIdentityKey(read) {
  return [
    read.path,
    read.contentHash,
    `${read.startLine}-${read.endLine}`,
    read.numbered ? "n" : "p"
  ].join("\n");
}
function isGogShellResult(turn) {
  return turn.tool === "os.shell.run" && turn.summary.includes("$ gog ");
}
function capSummary(summary, capChars) {
  if (summary.length <= capChars) return summary;
  const keep = Math.max(1, capChars - 40);
  return `${summary.slice(0, keep)}
\u2026 [rendering-truncated ${summary.length - keep} chars]`;
}
function capSummaryToTail(summary, capChars) {
  if (summary.length <= capChars) return summary;
  const keep = Math.max(1, capChars - 40);
  return `\u2026 [rendering-truncated ${summary.length - keep} chars]
${summary.slice(-keep)}`;
}
function readStartLineOf(args) {
  const offset = args.offset;
  if (typeof offset !== "number" || !Number.isFinite(offset)) return 1;
  const whole = Math.trunc(offset);
  if (whole < 0) return void 0;
  return Math.max(1, whole);
}
const READ_PAGING_HINT_RESERVE_CHARS = 260;
function capReadSummary(summary, capChars, startLine) {
  if (summary.length <= capChars) return summary;
  const budget = Math.max(1, capChars - READ_PAGING_HINT_RESERVE_CHARS);
  const lastBreak = summary.lastIndexOf("\n", budget);
  if (lastBreak < budget / 2) return capSummary(summary, capChars);
  const shown = summary.slice(0, lastBreak);
  const rest = summary.slice(lastBreak + 1).replace(/\r?\n$/, "");
  const shownLines = shown.split("\n").length;
  const hiddenLines = rest.split("\n").length;
  const next = startLine === void 0 ? "the line after the last one shown as `offset`" : `offset: ${startLine + shownLines}`;
  return `${shown}
\u2026 [prompt shows the first ${shownLines} lines of this read; ${hiddenLines} more lines are not shown, and reading the same range again shows the same cut. To see them, call os.fs.read with ${next} and limit: ${shownLines}]`;
}
function findCurrentMacroTurnStart(turns) {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (isFinalReplyTurn(turns[i])) return i + 1;
  }
  return 0;
}
const DEFAULT_CONVERSATION_LOW_WATER = 0.65;
function macroTurnBoundaries(turns, recorded) {
  if (turns.length === 0) return [];
  if (recorded && recorded.length > 0) {
    const seen = /* @__PURE__ */ new Set([0]);
    for (const index of recorded) {
      if (Number.isInteger(index) && index > 0 && index < turns.length) {
        seen.add(index);
      }
    }
    return [...seen].sort((a, b) => a - b);
  }
  const derived = [0];
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i]?.kind === "user" && isFinalReplyTurn(turns[i - 1])) {
      derived.push(i);
    }
  }
  return derived;
}
function pairTokenCosts(turns, recorded) {
  const boundaries = macroTurnBoundaries(turns, recorded);
  if (boundaries.length === 0) return [];
  const currentStart = findCurrentMacroTurnStart(turns);
  const repeats = readRepeatCosts(turns, currentStart);
  const costs = [];
  for (let k = 0; k < boundaries.length; k += 1) {
    const from = boundaries[k] ?? 0;
    const to = boundaries[k + 1] ?? turns.length;
    let sum = 0;
    for (let i = from; i < to; i += 1) {
      const turn = turns[i];
      if (!turn) continue;
      const previous = repeats.previous[i] ?? -1;
      sum += previous >= from ? repeats.costs[i] ?? 0 : tokenCostForTurn(turn, i >= currentStart);
    }
    costs.push(sum);
  }
  return costs;
}
function startIndexForPairs(boundaries, maxPairs) {
  if (boundaries.length === 0 || maxPairs <= 0) return 0;
  if (boundaries.length <= maxPairs) return 0;
  return boundaries[boundaries.length - maxPairs] ?? 0;
}
function countDroppedPairs(boundaries, startIndex, turnCount) {
  let dropped = 0;
  for (let k = 0; k < boundaries.length; k += 1) {
    const end = boundaries[k + 1] ?? turnCount;
    if (end <= startIndex) dropped += 1;
  }
  return dropped;
}
const SUMMARY_TOKEN_RESERVE = 40;
function lowWaterOf(options) {
  const raw = options.lowWater;
  if (raw === void 0 || !Number.isFinite(raw) || raw <= 0 || raw > 1) {
    return DEFAULT_CONVERSATION_LOW_WATER;
  }
  return raw;
}
function heldPackStart(packStart, turns) {
  if (!packStart) return null;
  const { index, at } = packStart;
  if (!Number.isInteger(index) || index <= 0 || index >= turns.length) {
    return null;
  }
  return turns[index]?.at === at ? packStart : null;
}
function startIndexForTokens(tokenCosts, budget, repeats) {
  const savings = new Array(tokenCosts.length).fill(0);
  for (let i = 0; i < tokenCosts.length; i += 1) {
    const previous = repeats.previous[i] ?? -1;
    if (previous === -1) continue;
    savings[previous] = (savings[previous] ?? 0) + (tokenCosts[i] ?? 0) - (repeats.costs[i] ?? 0);
  }
  let acc = 0;
  let startIndex = tokenCosts.length;
  for (let i = tokenCosts.length - 1; i >= 0; i -= 1) {
    const cost = (tokenCosts[i] ?? 0) - (savings[i] ?? 0);
    if (acc + cost > budget) break;
    acc += cost;
    startIndex = i;
  }
  return startIndex;
}
function suffixTokens(tokenCosts, repeats, from) {
  let sum = 0;
  for (let i = from; i < tokenCosts.length; i += 1) {
    const previous = repeats.previous[i] ?? -1;
    sum += previous >= from ? repeats.costs[i] ?? 0 : tokenCosts[i] ?? 0;
  }
  return sum;
}
function packConversation(turns, maxTokens, options = {}) {
  if (turns.length === 0) {
    return {
      visibleTurns: [],
      droppedSummary: null,
      droppedCount: 0,
      visiblePairs: 0,
      droppedPairs: 0,
      boundBy: null,
      packStart: null
    };
  }
  const boundaries = macroTurnBoundaries(turns, options.macroTurnStarts);
  if (maxTokens <= 0) {
    return {
      visibleTurns: [],
      droppedSummary: renderDroppedSummary(turns),
      droppedCount: turns.length,
      visiblePairs: 0,
      droppedPairs: boundaries.length,
      boundBy: "tokens",
      packStart: null
    };
  }
  const currentStart = findCurrentMacroTurnStart(turns);
  const tokenCosts = turns.map(
    (turn, i) => tokenCostForTurn(turn, i >= currentStart)
  );
  const repeats = readRepeatCosts(turns, currentStart);
  const budget = Math.max(1, maxTokens - SUMMARY_TOKEN_RESERVE);
  const lowWater = lowWaterOf(options);
  const held = heldPackStart(options.packStart, turns);
  const floor = held?.index ?? 0;
  const tokensFromFloor = suffixTokens(tokenCosts, repeats, floor);
  const pairsFromFloor = boundaries.length - countDroppedPairs(boundaries, floor, turns.length);
  const tokensOverflow = floor === 0 ? tokensFromFloor > maxTokens : tokensFromFloor > budget;
  const pairsOverflow = options.maxPairs !== void 0 && pairsFromFloor > options.maxPairs;
  let startIndex;
  let boundBy;
  if (!tokensOverflow && !pairsOverflow) {
    startIndex = floor;
    boundBy = held?.boundBy ?? null;
  } else {
    const tokenStart = tokensOverflow ? Math.max(
      floor,
      startIndexForTokens(
        tokenCosts,
        Math.max(1, Math.floor(budget * lowWater)),
        repeats
      )
    ) : floor;
    const pairsStart = pairsOverflow && options.maxPairs !== void 0 ? Math.max(
      floor,
      startIndexForPairs(
        boundaries,
        Math.max(1, Math.floor(options.maxPairs * lowWater))
      )
    ) : floor;
    startIndex = Math.max(tokenStart, pairsStart);
    boundBy = pairsOverflow && pairsStart >= tokenStart ? "pairs" : "tokens";
  }
  const lastUserIndex = findLastUserIndex(turns);
  if (lastUserIndex !== -1 && lastUserIndex < startIndex) {
    startIndex = lastUserIndex;
  }
  if (options.pinCurrentTask !== false && currentStart < startIndex && turns[currentStart]?.kind === "user") {
    startIndex = currentStart;
  }
  const droppedSlice = turns.slice(0, startIndex);
  const visibleTurns = turns.slice(startIndex);
  const droppedPairs = countDroppedPairs(boundaries, startIndex, turns.length);
  const visiblePairs = Math.max(0, boundaries.length - droppedPairs);
  if (droppedSlice.length === 0) {
    return {
      visibleTurns,
      droppedSummary: null,
      droppedCount: 0,
      visiblePairs,
      droppedPairs,
      boundBy: null,
      packStart: null
    };
  }
  return {
    visibleTurns,
    droppedSummary: renderDroppedSummary(droppedSlice, droppedPairs),
    droppedCount: droppedSlice.length,
    visiblePairs,
    droppedPairs,
    boundBy: boundBy ?? "tokens",
    packStart: {
      index: startIndex,
      at: turns[startIndex]?.at ?? 0,
      boundBy: boundBy ?? "tokens"
    }
  };
}
const TURN_TOKEN_COST_CACHE = /* @__PURE__ */ new WeakMap();
function tokenCostForTurn(turn, inCurrentMacroTurn) {
  const key = turn;
  const slot = TURN_TOKEN_COST_CACHE.get(key);
  const cached = inCurrentMacroTurn ? slot?.fresh : slot?.aged;
  if (cached !== void 0) return cached;
  const cost = estimateTokens(renderTurnForPrompt(turn, { inCurrentMacroTurn })) + 1;
  const nextSlot = slot ?? {};
  if (inCurrentMacroTurn) nextSlot.fresh = cost;
  else nextSlot.aged = cost;
  TURN_TOKEN_COST_CACHE.set(key, nextSlot);
  return cost;
}
function readRepeatCosts(turns, currentStart) {
  const previous = findReadRepeats(turns);
  const costs = new Array(turns.length).fill(0);
  if (!previous.some((p) => p !== -1)) return { previous, costs };
  const refs = readRepeatRefs(turns, previous);
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    const ref = refs[i];
    if (!turn || ref === void 0) continue;
    const key = turn;
    const slot = TURN_TOKEN_COST_CACHE.get(key) ?? {};
    if (slot.repeat === void 0) {
      slot.repeat = estimateTokens(
        renderTurnForPrompt(turn, {
          inCurrentMacroTurn: i >= currentStart,
          readRepeat: ref
        })
      ) + 1;
      TURN_TOKEN_COST_CACHE.set(key, slot);
    }
    costs[i] = slot.repeat;
  }
  return { previous, costs };
}
function trimTurnsToTokens(turns, maxTokens) {
  const packed = packConversation(turns, maxTokens);
  return {
    turns: packed.visibleTurns,
    truncated: packed.droppedCount > 0
  };
}
function renderDroppedSummary(turns, droppedPairs = 0) {
  let user = 0;
  let toolCalls = 0;
  let replies = 0;
  for (const t of turns) {
    if (t.kind === "user") user += 1;
    else if (t.kind === "assistant_tool_call") toolCalls += 1;
    else if (isFinalReplyTurn(t)) replies += 1;
  }
  const first = turns[0]?.at ?? 0;
  const last = turns[turns.length - 1]?.at ?? first;
  const firstIso = new Date(first).toISOString();
  const lastIso = new Date(last).toISOString();
  const tasks = droppedPairs > 0 ? ` from ${droppedPairs} earlier task${droppedPairs === 1 ? "" : "s"}` : "";
  return `summary: ${turns.length} older turns dropped${tasks} (${user} user, ${toolCalls} tool calls, ${replies} replies; first at ${firstIso}, last at ${lastIso})`;
}
function findLastUserIndex(turns) {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.kind === "user") return i;
  }
  return -1;
}
function appendTurn(turns, next) {
  return [...turns, next];
}
export {
  DEFAULT_CONVERSATION_LOW_WATER,
  STOPPED_TURN_MARKER_TEXT,
  appendTurn,
  assistantReplyTurn,
  assistantToolCallTurn,
  capReadSummary,
  findCurrentMacroTurnStart,
  findReadRepeats,
  isFinalReplyTurn,
  isStoppedTurnMarker,
  macroTurnBoundaries,
  packConversation,
  pairTokenCosts,
  readRepeatRefs,
  readRepeatStub,
  readStartLineOf,
  renderToolResultBody,
  renderTurnForPrompt,
  steeredUserTurn,
  stoppedTurnMarker,
  toolResultTurn,
  trimTurnsToTokens,
  userTurn
};
