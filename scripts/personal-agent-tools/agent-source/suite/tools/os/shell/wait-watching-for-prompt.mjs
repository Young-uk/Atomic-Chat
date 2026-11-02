import {
  detectInteractivePrompt
} from "./interactive-prompt.mjs";
const PROMPT_POLL_MS = 1e3;
const PROMPT_QUIET_MS = 4e3;
async function waitWatchingForPrompt(job, timeoutMs, signal, timing = {}) {
  const pollMs = timing.pollMs ?? PROMPT_POLL_MS;
  const quietMs = timing.quietMs ?? PROMPT_QUIET_MS;
  const deadline = timeoutMs > 0 && Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let lastSeen = "";
  let lastChange = Date.now();
  for (; ; ) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { outcome: "elapsed", prompt: null };
    const outcome = await job.waitFor(Math.min(pollMs, remaining), signal);
    if (outcome !== "elapsed") return { outcome, prompt: null };
    const output = job.output();
    const seen = `${output.stdout.length}:${output.stderr.length}:${output.stdout.slice(-200)}:${output.stderr.slice(-200)}`;
    const now = Date.now();
    if (seen !== lastSeen) {
      lastSeen = seen;
      lastChange = now;
      continue;
    }
    if (now - lastChange < quietMs) continue;
    const prompt = detectInteractivePrompt(output.stdout, "running") ?? detectInteractivePrompt(output.stderr, "running");
    if (prompt !== null) return { outcome: "elapsed", prompt };
  }
}
export {
  PROMPT_POLL_MS,
  PROMPT_QUIET_MS,
  waitWatchingForPrompt
};
