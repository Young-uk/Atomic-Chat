function resolveShellTimeout(rawTimeoutMs, defaultTimeoutMs) {
  if (typeof rawTimeoutMs === "number" && Number.isFinite(rawTimeoutMs)) {
    return { timeoutMs: Math.max(0, rawTimeoutMs), source: "explicit" };
  }
  const fallback = Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0 ? defaultTimeoutMs : 0;
  return { timeoutMs: fallback, source: "default" };
}
function formatShellDuration(ms) {
  if (ms >= 6e4 && ms % 6e4 === 0) return `${ms / 6e4} min`;
  const seconds = ms / 1e3;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}
function formatShellElapsed(ms) {
  const seconds = Math.round(ms / 1e3);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
function formatShellTimeoutNotice(timeout) {
  return `stopped after ${formatShellDuration(timeout.timeoutMs)} (timeoutMs) \u2014 output so far below; pass a larger timeoutMs for a longer run, or 0 for no limit`;
}
function formatShellDetachNotice(input) {
  const { jobId } = input;
  const after = formatShellDuration(input.waitedMs);
  const perCall = input.defaultTimeoutMs > 0 ? ` (up to another ${formatShellDuration(input.defaultTimeoutMs)} per call)` : "";
  const forms = `os.shell.run {"wait": ${jobId}} keeps waiting${perCall}, {"kill": ${jobId}} stops it`;
  if (!input.again) {
    return `still running after ${after} (job ${jobId}) \u2014 output so far below; ${forms}, pass timeoutMs for a longer first wait`;
  }
  return `still running after another ${after} (job ${jobId}) \u2014 output so far below; ${forms}, pass timeoutMs with the wait for a longer one`;
}
function describeShellTimeoutDefault(defaultTimeoutMs) {
  if (Number.isFinite(defaultTimeoutMs) && defaultTimeoutMs > 0) {
    const limit = formatShellDuration(defaultTimeoutMs);
    return `Timeout: default ${limit} \u2014 a command still running then is not killed but detached as a job, and the result names it: {"wait": id} waits for it (up to another ${limit} per call; timeoutMs sets the wait), {"kill": id} stops it, {"jobs": true} lists this session's jobs; a job dies when the turn ends unless the call carried keep: true. Pass \`timeoutMs\` to stop the command at an explicit limit instead, \`0\` for none.`;
  }
  return "By default there is no timeout (the command runs until it exits or the turn is cancelled); pass `timeoutMs` to set an explicit limit.";
}
function formatShellBackgroundNotice(jobId) {
  return `started in the background as job ${jobId} (kept: it survives the end of this turn and stops when the session ends) \u2014 output so far below; os.shell.run {"wait": ${jobId}, "timeoutMs": 2000} reads newer output, {"kill": ${jobId}} stops it, {"jobs": true} lists jobs`;
}
export {
  describeShellTimeoutDefault,
  formatShellBackgroundNotice,
  formatShellDetachNotice,
  formatShellDuration,
  formatShellElapsed,
  formatShellTimeoutNotice,
  resolveShellTimeout
};
