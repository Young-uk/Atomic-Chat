import { basename } from "node:path";
import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import { requestWords } from "../../../prompt/request-section.mjs";
import { answersReplaceQuestion } from "./fs-input-consent.mjs";
import { requestAsksToReplace, requestNamesFile } from "./fs-input-words.mjs";
import {
  countLines,
  formatBytes,
  formatLines,
  formatNumber
} from "./fs-replace-guard.mjs";
import {
  REPLACE_VERBS,
  REPLACE_VERB_WINDOW_WORDS,
  requestAsksToReplace as requestAsksToReplace2,
  requestNamesFile as requestNamesFile2
} from "./fs-input-words.mjs";
import {
  answersReplaceQuestion as answersReplaceQuestion2,
  followUpAsksToReplace,
  replyAsksToReplace
} from "./fs-input-consent.mjs";
async function checkInputReplacement(input) {
  if (input.declaredInputs?.includes(input.absolute)) {
    return refusal("contract", input);
  }
  const request = input.request?.trim() ?? "";
  if (request.length === 0 || input.store === void 0 || input.prior.bytes === 0) {
    return null;
  }
  const name = basename(input.absolute);
  const { names, consent } = requestWords(request);
  if (!requestNamesFile(names, name) || requestAsksToReplace(consent, name) || answersReplaceQuestion(consent, input.previousReply, name)) {
    return null;
  }
  if (await input.store.wasCreated(input.sessionId, input.absolute)) {
    return null;
  }
  return refusal("request", input);
}
function formatReplacementCounts(prior, linesAfter) {
  return prior.lines === null ? `${formatBytes(prior.bytes)} \u2192 ${formatLines(linesAfter)}` : `${formatLines(prior.lines)} \u2192 ${formatNumber(linesAfter)}`;
}
function refusal(reason, input) {
  const linesAfter = countLines(input.after);
  const counts = formatReplacementCounts(input.prior, linesAfter);
  const text = reason === "request" ? `refused: ${input.display} is an input the request names (${counts}); write the result to a new file, or edit it in place (os.fs.edit / os.fs.patch). To replace the file itself, stop and reply with one yes/no question: "Replace ${basename(input.absolute)}?" A write before the user answers yes is refused again` : `refused: ${input.display} is an input this fan-out declared (${counts}); edit it in place (os.fs.edit / os.fs.patch) \u2014 a worker cannot replace a declared input; if the task needs it replaced, say so in your reply so the orchestrator can redeclare it`;
  return {
    reason,
    text,
    details: {
      refused: "input",
      input: reason,
      path: input.absolute,
      display: input.display,
      bytesBefore: input.prior.bytes,
      linesBefore: input.prior.lines,
      linesAfter,
      overwrite: input.overwrite
    }
  };
}
const INPUT_REFUSAL_SUMMARY_CHARS = 1600;
function refuseInputReplacement(tool, refused) {
  return compressToolResult(
    {
      tool,
      status: "error",
      output: refused.text,
      details: refused.details
    },
    { maxSummaryLength: INPUT_REFUSAL_SUMMARY_CHARS }
  );
}
export {
  INPUT_REFUSAL_SUMMARY_CHARS,
  REPLACE_VERBS,
  REPLACE_VERB_WINDOW_WORDS,
  answersReplaceQuestion2 as answersReplaceQuestion,
  checkInputReplacement,
  followUpAsksToReplace,
  formatReplacementCounts,
  refuseInputReplacement,
  replyAsksToReplace,
  requestAsksToReplace2 as requestAsksToReplace,
  requestNamesFile2 as requestNamesFile
};
