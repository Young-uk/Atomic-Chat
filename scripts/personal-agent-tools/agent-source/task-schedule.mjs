import { CronExpressionParser } from "cron-parser";
import { TaskValidationError } from "./task-types.mjs";
const SCHEDULE_INTERVAL_MIN_MS = 1e3;
const SCHEDULE_AT_MAX_AHEAD_MS = 10 * 365 * 24 * 60 * 60 * 1e3;
const SCHEDULE_CRON_MAX_LENGTH = 200;
function isRecurring(schedule) {
  if (!schedule) return false;
  return schedule.kind === "cron" || schedule.kind === "interval";
}
function resolveScheduledFor(schedule, fromMs) {
  validateSchedule(schedule, fromMs);
  if (schedule.kind === "at") {
    return schedule.at;
  }
  if (schedule.kind === "interval") {
    return fromMs + schedule.everyMs;
  }
  const options = {
    currentDate: new Date(fromMs),
    ...schedule.tz ? { tz: schedule.tz } : {}
  };
  try {
    const iter = CronExpressionParser.parse(schedule.expression, options);
    return iter.next().toDate().getTime();
  } catch (err) {
    throw new TaskValidationError(
      "schedule",
      `invalid cron expression: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function validateSchedule(schedule, fromMs) {
  if (!schedule || typeof schedule !== "object") {
    throw new TaskValidationError("schedule", "schedule must be an object");
  }
  if (schedule.kind === "at") {
    if (typeof schedule.at !== "number" || !Number.isFinite(schedule.at)) {
      throw new TaskValidationError(
        "schedule",
        "schedule.at must be a finite number (Unix ms)"
      );
    }
    if (schedule.at - fromMs > SCHEDULE_AT_MAX_AHEAD_MS) {
      throw new TaskValidationError(
        "schedule",
        `schedule.at must be within ${SCHEDULE_AT_MAX_AHEAD_MS} ms of now`
      );
    }
    return;
  }
  if (schedule.kind === "interval") {
    if (typeof schedule.everyMs !== "number" || !Number.isFinite(schedule.everyMs) || !Number.isInteger(schedule.everyMs)) {
      throw new TaskValidationError(
        "schedule",
        "schedule.everyMs must be a finite integer"
      );
    }
    if (schedule.everyMs < SCHEDULE_INTERVAL_MIN_MS) {
      throw new TaskValidationError(
        "schedule",
        `schedule.everyMs must be >= ${SCHEDULE_INTERVAL_MIN_MS}`
      );
    }
    return;
  }
  if (schedule.kind === "cron") {
    if (typeof schedule.expression !== "string" || schedule.expression.length === 0) {
      throw new TaskValidationError(
        "schedule",
        "schedule.expression must be a non-empty string"
      );
    }
    if (schedule.expression.length > SCHEDULE_CRON_MAX_LENGTH) {
      throw new TaskValidationError(
        "schedule",
        `schedule.expression must be <= ${SCHEDULE_CRON_MAX_LENGTH} chars`
      );
    }
    if (schedule.tz !== void 0 && typeof schedule.tz !== "string") {
      throw new TaskValidationError(
        "schedule",
        "schedule.tz must be a string or omitted"
      );
    }
    try {
      CronExpressionParser.parse(schedule.expression, {
        currentDate: new Date(fromMs),
        ...schedule.tz ? { tz: schedule.tz } : {}
      });
    } catch (err) {
      throw new TaskValidationError(
        "schedule",
        `invalid cron expression: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return;
  }
  throw new TaskValidationError(
    "schedule",
    `unknown schedule kind: ${JSON.stringify(schedule.kind)}`
  );
}
function serializeScheduleValue(schedule) {
  if (schedule.kind === "at") return JSON.stringify({ at: schedule.at });
  if (schedule.kind === "interval")
    return JSON.stringify({ everyMs: schedule.everyMs });
  return JSON.stringify({
    expression: schedule.expression,
    ...schedule.tz ? { tz: schedule.tz } : {}
  });
}
function peekNextFirings(schedule, fromMs, count = 5) {
  if (count <= 0) return [];
  try {
    validateSchedule(schedule, fromMs);
  } catch {
    return [];
  }
  if (schedule.kind === "at") {
    return [schedule.at];
  }
  if (schedule.kind === "interval") {
    const firings = [];
    let cursor = fromMs;
    for (let i = 0; i < count; i += 1) {
      cursor = cursor + schedule.everyMs;
      firings.push(cursor);
    }
    return firings;
  }
  const options = {
    currentDate: new Date(fromMs),
    ...schedule.tz ? { tz: schedule.tz } : {}
  };
  try {
    const iter = CronExpressionParser.parse(schedule.expression, options);
    const firings = [];
    for (let i = 0; i < count; i += 1) {
      firings.push(iter.next().toDate().getTime());
    }
    return firings;
  } catch {
    return [];
  }
}
function parseScheduleRow(kind, value) {
  if (!kind || !value) return null;
  const body = JSON.parse(value);
  if (kind === "at") {
    return { kind: "at", at: Number(body.at) };
  }
  if (kind === "interval") {
    return { kind: "interval", everyMs: Number(body.everyMs) };
  }
  if (kind === "cron") {
    return {
      kind: "cron",
      expression: String(body.expression),
      ...typeof body.tz === "string" ? { tz: body.tz } : {}
    };
  }
  return null;
}
export {
  SCHEDULE_AT_MAX_AHEAD_MS,
  SCHEDULE_CRON_MAX_LENGTH,
  SCHEDULE_INTERVAL_MIN_MS,
  isRecurring,
  parseScheduleRow,
  peekNextFirings,
  resolveScheduledFor,
  serializeScheduleValue,
  validateSchedule
};
