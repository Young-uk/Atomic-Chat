const DEFAULT_SHELL_JOB_MAX_MS = 36e5;
const DEFAULT_SHELL_MAX_JOBS = 3;
const MAX_FINISHED_RECORDS = 20;
function positiveOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
class ShellJobRegistry {
  jobMaxMs;
  maxJobs;
  bySession = /* @__PURE__ */ new Map();
  nextIds = /* @__PURE__ */ new Map();
  ceilings = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.jobMaxMs = positiveOr(options.jobMaxMs, DEFAULT_SHELL_JOB_MAX_MS);
    this.maxJobs = positiveOr(options.maxJobs, DEFAULT_SHELL_MAX_JOBS);
  }
  /**
   * Take a job the default timeout detached. When the session already
   * runs `maxJobs`, the oldest un-kept running job (the oldest kept one
   * when all are kept) is stopped first and returned as `evicted`.
   */
  register(sessionId, job, facts, keep) {
    const records = this.records(sessionId);
    let evicted = null;
    const running = records.filter((r) => r.state === "running");
    if (running.length >= this.maxJobs) {
      evicted = running.find((r) => !r.keep) ?? running[0];
      this.stop(evicted, "evicted");
    }
    const id = this.nextIds.get(sessionId) ?? 1;
    this.nextIds.set(sessionId, id + 1);
    const record = {
      id,
      sessionId,
      facts,
      job,
      keep,
      state: "running",
      stopReason: null
    };
    records.push(record);
    const settle = () => {
      if (record.state === "running") record.state = "exited";
      this.clearCeiling(record);
    };
    job.exit.then(settle, settle);
    const remaining = Math.max(0, this.jobMaxMs - (Date.now() - job.startedAt));
    const timer = setTimeout(() => this.stop(record, "ceiling"), remaining);
    timer.unref();
    this.ceilings.set(record, timer);
    this.trimFinished(records);
    return { record, evicted };
  }
  /** A job of this session only — another session's id is unknown here. */
  get(sessionId, id) {
    return this.bySession.get(sessionId)?.find((r) => r.id === id);
  }
  /** This session's records, oldest first; finished ones until collected. */
  list(sessionId) {
    return [...this.bySession.get(sessionId) ?? []];
  }
  markKeep(record) {
    record.keep = true;
  }
  /**
   * Stop a running job politely (`SIGTERM`, then `SIGKILL` after the
   * grace) and mark why. `false` when it was not running.
   */
  stop(record, reason) {
    if (record.state !== "running") return false;
    record.state = "killed";
    record.stopReason = reason;
    this.clearCeiling(record);
    record.job.stop();
    return true;
  }
  /** Forget a record whose result was reported (a `wait` or a `kill` collected it). */
  drop(record) {
    this.clearCeiling(record);
    const records = this.bySession.get(record.sessionId);
    if (!records) return;
    const index = records.indexOf(record);
    if (index >= 0) records.splice(index, 1);
    if (records.length === 0) this.bySession.delete(record.sessionId);
  }
  /**
   * The turn ended: every un-kept job of the session is stopped and
   * forgotten, collected or not. Kept ones stay, running or exited,
   * for a later turn's `wait`. Returns the jobs that were stopped.
   */
  endTurn(sessionId) {
    return this.endRecords(this.list(sessionId).filter((r) => !r.keep), "turn_end");
  }
  /** The session ended: every job of it, kept or not. */
  endSession(sessionId) {
    return this.endRecords(this.list(sessionId), "session_end");
  }
  /** The process is shutting down: every job of every session. */
  endAll() {
    const all = [...this.bySession.keys()].flatMap((id) => this.list(id));
    return this.endRecords(all, "shutdown");
  }
  endRecords(records, reason) {
    const stopped = [];
    for (const record of records) {
      if (this.stop(record, reason)) stopped.push(record);
      this.drop(record);
    }
    return stopped;
  }
  records(sessionId) {
    let records = this.bySession.get(sessionId);
    if (!records) {
      records = [];
      this.bySession.set(sessionId, records);
    }
    return records;
  }
  clearCeiling(record) {
    const timer = this.ceilings.get(record);
    if (timer) clearTimeout(timer);
    this.ceilings.delete(record);
  }
  /** Bound the memory a session's uncollected output can hold. */
  trimFinished(records) {
    let finished = records.filter((r) => r.state !== "running");
    while (finished.length > MAX_FINISHED_RECORDS) {
      this.drop(finished[0]);
      finished = finished.slice(1);
    }
  }
}
export {
  DEFAULT_SHELL_JOB_MAX_MS,
  DEFAULT_SHELL_MAX_JOBS,
  ShellJobRegistry
};
