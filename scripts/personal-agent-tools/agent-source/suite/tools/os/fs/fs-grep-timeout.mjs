import {
  retainToolOutput
} from "../../../compressor/result-compressor.mjs";
function describeGrepTimeout(stop) {
  const seconds = Math.round(stop.elapsedMs / 100) / 10;
  return `[partial results: search stopped after ${seconds} s (time limit reached); files not yet searched are missing and the last one may be incomplete. Narrow the pattern, the path or the glob and retry.]`;
}
function withTimeoutNote(result, stop) {
  const note = describeGrepTimeout(stop);
  const prefix = `${note}
`;
  return retainToolOutput(
    result,
    {
      ...result,
      summary: `${prefix}${result.summary}`,
      truncated: true,
      details: {
        ...result.details,
        truncated: true,
        stoppedBy: "time",
        elapsedMs: stop.elapsedMs,
        note
      }
    },
    { prefix, truncated: true }
  );
}
export {
  describeGrepTimeout,
  withTimeoutNote
};
