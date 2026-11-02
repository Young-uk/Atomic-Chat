const MACRO_TURN_START_CAP = 200;
function appendMacroTurnStart(starts, index) {
  const prev = starts ?? [];
  if (prev[prev.length - 1] === index) return prev;
  const next = [...prev, index];
  return next.length > MACRO_TURN_START_CAP ? next.slice(next.length - MACRO_TURN_START_CAP) : next;
}
function macroTurnStartsFromTurns(turns) {
  let starts = [];
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i]?.kind === "user") starts = appendMacroTurnStart(starts, i);
  }
  return starts;
}
export {
  MACRO_TURN_START_CAP,
  appendMacroTurnStart,
  macroTurnStartsFromTurns
};
