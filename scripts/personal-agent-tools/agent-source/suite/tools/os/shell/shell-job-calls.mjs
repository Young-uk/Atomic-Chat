import {
  compressToolResult
} from "../../../compressor/result-compressor.mjs";
import { listingResultCaps } from "../../../compressor/listing-caps.mjs";
import {
  awaitJobExit
} from "../../../sandbox/command-job.mjs";
import {
  formatExitStatus,
  joinShellOutput,
  renderShellExit,
  renderShellResult,
  tailShellOutput
} from "./shell-result.mjs";
import {
  formatShellDetachNotice,
  formatShellElapsed,
  resolveShellTimeout
} from "./shell-timeout.mjs";
const RUNNING_TAIL_LINES = 8;
const KILLED_TAIL_LINES = 9;
function isPresent(key, value) {
  if (value === void 0 || value === null || value === false) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if ((key === "wait" || key === "kill") && isZeroId(value)) return false;
  return true;
}
function isZeroId(value) {
  return value === 0 || typeof value === "string" && value.trim() === "0";
}
function jobIdHint(kind) {
  return `os.shell.run: ${kind} must be a job id (a positive integer), e.g. {"${kind}": 3}; {"jobs": true} lists them`;
}
function parseJobId(raw) {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}
function classifyShellCall(rawArgs) {
  const present = ["cmd", "wait", "kill", "jobs"].filter(
    (key) => isPresent(key, rawArgs[key])
  );
  if (present.length > 1) {
    return {
      kind: "invalid",
      message: `os.shell.run: pass one of cmd, wait, kill, jobs (got ${present.join(", ")})`
    };
  }
  if (isPresent("jobs", rawArgs.jobs)) return { kind: "jobs" };
  for (const kind of ["wait", "kill"]) {
    if (!isPresent(kind, rawArgs[kind])) continue;
    const id = parseJobId(rawArgs[kind]);
    if (id === null) return { kind: "invalid", message: jobIdHint(kind) };
    return { kind, id };
  }
  if (present.length === 0) {
    for (const kind of ["wait", "kill"]) {
      if (isZeroId(rawArgs[kind])) return { kind: "invalid", message: jobIdHint(kind) };
    }
  }
  return { kind: "cmd" };
}
function headOfCommand(commandLine, max = 60) {
  const line = commandLine.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}
const STOP_WORDING = {
  kill: "on request",
  turn_end: "at the turn's end",
  session_end: "at the session's end",
  evicted: "to stay within the job limit",
  ceiling: "at the job ceiling",
  shutdown: "at shutdown"
};
function renderShellDetached(record, input) {
  const output = record.job.output();
  const runningMs = Date.now() - record.job.startedAt;
  const notices = [...input.notices ?? []];
  if (input.evicted) {
    const which = input.evicted.keep ? "job (kept ones included)" : "un-kept job";
    notices.push(
      `job ${input.evicted.id} (${headOfCommand(input.evicted.facts.commandLine)}) was stopped to stay within ${input.maxJobs ?? "the limit of"} running jobs \u2014 the oldest ${which}`
    );
  }
  notices.push(
    input.detachNotice ?? formatShellDetachNotice({
      jobId: record.id,
      waitedMs: input.waitedMs,
      again: input.again,
      defaultTimeoutMs: input.defaultTimeoutMs
    })
  );
  return renderShellResult({
    facts: record.facts,
    status: "ok",
    notices,
    statusLine: `still running (job ${record.id}, pid ${record.job.pid ?? "?"}, ${formatShellElapsed(runningMs)}${record.keep ? ", kept" : ""})`,
    body: tailShellOutput(joinShellOutput(output), RUNNING_TAIL_LINES),
    // A status report: the notice on top is the point, not the excerpt.
    overflow: "head",
    details: {
      detached: true,
      jobId: record.id,
      pid: record.job.pid ?? null,
      runningMs,
      keep: record.keep,
      timedOut: false,
      truncated: output.truncated,
      ...input.evicted ? { evictedJobId: input.evicted.id } : {}
    }
  });
}
function renderShellKilled(record, exit, output) {
  const reason = record.stopReason ?? "kill";
  return renderShellResult({
    facts: record.facts,
    status: "ok",
    notices: [],
    statusLine: `killed (job ${record.id}, ${STOP_WORDING[reason]}) after ${formatShellElapsed(exit.durationMs)}, exit: ${formatExitStatus(exit)}`,
    body: tailShellOutput(joinShellOutput(output), KILLED_TAIL_LINES),
    overflow: "head",
    details: {
      killed: true,
      jobId: record.id,
      pid: record.job.pid ?? null,
      stopReason: reason,
      exitCode: exit.exitCode,
      signal: exit.signal,
      durationMs: exit.durationMs,
      timedOut: false,
      truncated: output.truncated
    }
  });
}
function unknownJob(ctx, id) {
  const ids = ctx.jobs.list(ctx.sessionId).map((record) => record.id);
  const now = ids.length === 0 ? "this session has no jobs now" : `this session's jobs now: ${ids.join(", ")}`;
  return compressToolResult({
    tool: "os.shell.run",
    status: "error",
    output: `unknown job ${id} in this session; ${now}. A job id exists only after an os.shell.run command came back with it, and a job that was not kept (\`background: true\` or \`keep: true\`) ends with the turn that started it, so do not poll for it again: run the command with {"cmd": \u2026} if it is still needed.`,
    details: { jobId: id, unknownJob: true, jobIds: ids }
  });
}
async function collect(jobs, record) {
  const exit = await awaitJobExit(record.job);
  jobs.drop(record);
  const output = record.job.output();
  if (record.state === "killed") return renderShellKilled(record, exit, output);
  return renderShellExit(record.facts, exit, output, { jobId: record.id });
}
async function runShellWait(ctx, id, rawTimeoutMs, keep) {
  const record = ctx.jobs.get(ctx.sessionId, id);
  if (!record) return unknownJob(ctx, id);
  if (keep) ctx.jobs.markKeep(record);
  const timeout = resolveShellTimeout(rawTimeoutMs, ctx.defaultTimeoutMs);
  if (record.state === "running") {
    const outcome = await record.job.waitFor(timeout.timeoutMs, ctx.signal).catch(() => "exited");
    if (outcome !== "exited") {
      return renderShellDetached(record, {
        waitedMs: timeout.timeoutMs,
        again: true,
        defaultTimeoutMs: ctx.defaultTimeoutMs
      });
    }
  }
  return collect(ctx.jobs, record);
}
async function runShellKill(ctx, id) {
  const record = ctx.jobs.get(ctx.sessionId, id);
  if (!record) return unknownJob(ctx, id);
  ctx.jobs.stop(record, "kill");
  return collect(ctx.jobs, record);
}
function describeJobState(record) {
  const exit = record.job.exited();
  if (record.state === "running") {
    return `running ${formatShellElapsed(Date.now() - record.job.startedAt)}${record.keep ? ", kept" : ""} (pid ${record.job.pid ?? "?"})`;
  }
  const collectHint = `{"wait": ${record.id}} collects the output`;
  if (record.state === "killed") {
    return `stopped ${STOP_WORDING[record.stopReason ?? "kill"]} \u2014 ${collectHint}`;
  }
  return `exited ${exit ? formatExitStatus(exit) : "?"} after ${formatShellElapsed(exit?.durationMs ?? 0)} \u2014 ${collectHint}`;
}
const JOB_CHARS = 150;
function listShellJobs(ctx) {
  const records = ctx.jobs.list(ctx.sessionId);
  const lines = records.map(
    (record) => `job ${record.id}: ${headOfCommand(record.facts.commandLine)} \u2014 ${describeJobState(record)}`
  );
  return compressToolResult(
    {
      tool: "os.shell.run",
      status: "ok",
      output: lines.length > 0 ? lines.join("\n") : "no jobs in this session",
      details: {
        jobs: records.map((record) => ({
          id: record.id,
          cmd: headOfCommand(record.facts.commandLine, 200),
          startedAt: new Date(record.job.startedAt).toISOString(),
          state: record.state,
          pid: record.job.pid ?? null,
          keep: record.keep,
          runningMs: Date.now() - record.job.startedAt,
          exitCode: record.job.exited()?.exitCode ?? null,
          stopReason: record.stopReason
        }))
      }
    },
    // This listing is how a model finds its own jobs — `unknownJob`
    // points it right here — and it bypasses `renderShellResult`, so
    // it keeps the raw compressor defaults: the last 12 lines, then
    // 385 chars. The registry already bounds the rows (`maxJobs`
    // running, plus the finished records it keeps), so budget the rows
    // we are about to print at JOB_CHARS each: a 60-char command head
    // (`headOfCommand`) plus the state sentence, which carries the
    // `{"wait": n}` hint the model needs next.
    listingResultCaps(records.length, JOB_CHARS)
  );
}
export {
  classifyShellCall,
  headOfCommand,
  listShellJobs,
  renderShellDetached,
  runShellKill,
  runShellWait
};
