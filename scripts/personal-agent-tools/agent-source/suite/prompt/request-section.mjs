import {
  isStoppedTurnMarker
} from "../session/conversation-turn.mjs";
const REQUEST_SECTION_CHAR_BUDGET = 16e3;
const REQUEST_FOLLOW_UP_MARKER = "[the operator's latest message, which started this turn]";
const ORIGINAL_REQUEST_BEGIN_MARKER = "----- BEGIN ORIGINAL REQUEST -----";
const ORIGINAL_REQUEST_END_MARKER = "----- END ORIGINAL REQUEST -----";
function quotedRequestText(request) {
  const begin = request.indexOf(ORIGINAL_REQUEST_BEGIN_MARKER);
  if (begin === -1) return request;
  const start = begin + ORIGINAL_REQUEST_BEGIN_MARKER.length;
  const end = request.indexOf(ORIGINAL_REQUEST_END_MARKER, start);
  return end === -1 ? request.slice(start) : request.slice(start, end);
}
const NO_OPERATOR_WORDS_MARKER = "[a worker brief without an ORIGINAL REQUEST block: no operator words]";
function workerRequestRecord(brief) {
  return brief.includes(ORIGINAL_REQUEST_BEGIN_MARKER) ? brief : `${NO_OPERATOR_WORDS_MARKER}
${brief}`;
}
function requestWords(request) {
  if (request.startsWith(NO_OPERATOR_WORDS_MARKER)) {
    return { names: request.slice(NO_OPERATOR_WORDS_MARKER.length), consent: "" };
  }
  const quoted = quotedRequestText(request);
  return { names: quoted, consent: quoted };
}
function previousReplyText(earlierTurns) {
  for (let i = earlierTurns.length - 1; i >= 0; i -= 1) {
    const turn = earlierTurns[i];
    if (turn.kind === "user") return void 0;
    if (turn.kind !== "assistant_reply" || turn.progressNote === true) continue;
    if (isStoppedTurnMarker(turn)) return void 0;
    const text = turn.text.trim();
    return text.length === 0 ? void 0 : text;
  }
  return void 0;
}
function requestCarrierText(request) {
  const marker = `

${REQUEST_FOLLOW_UP_MARKER}
`;
  const at = request.indexOf(marker);
  return (at === -1 ? request : request.slice(0, at)).trim();
}
function requestInView(request, visibleTurns) {
  const carrier = requestCarrierText(request);
  if (carrier.length === 0) return true;
  return visibleTurns.some(
    (turn) => turn.kind === "user" && turn.text.trim() === carrier
  );
}
function formatCount(n) {
  return n.toLocaleString("en-US");
}
function renderRequestSection(request) {
  const text = request.trim();
  const clipped = text.length > REQUEST_SECTION_CHAR_BUDGET ? text.slice(0, REQUEST_SECTION_CHAR_BUDGET) : text;
  const lines = [
    "The operator's request that started this task. The turn that carried it has been dropped from the conversation below; this is what the work must still satisfy.",
    clipped
  ];
  if (clipped.length < text.length) {
    lines.push(
      `(truncated: the request is ${formatCount(text.length)} chars; only the first ${formatCount(REQUEST_SECTION_CHAR_BUDGET)} are shown.)`
    );
  }
  return lines.join("\n");
}
export {
  NO_OPERATOR_WORDS_MARKER,
  ORIGINAL_REQUEST_BEGIN_MARKER,
  ORIGINAL_REQUEST_END_MARKER,
  REQUEST_FOLLOW_UP_MARKER,
  REQUEST_SECTION_CHAR_BUDGET,
  previousReplyText,
  quotedRequestText,
  renderRequestSection,
  requestCarrierText,
  requestInView,
  requestWords,
  workerRequestRecord
};
