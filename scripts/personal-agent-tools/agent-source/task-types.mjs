const TASK_NOTIFY_TARGETS = ["telegram"];
const TASK_USER_MESSAGE_MAX_LENGTH = 16e3;
const TASK_LAST_ERROR_MAX_LENGTH = 2e3;
class TaskValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = "TaskValidationError";
  }
}
class TaskStateError extends Error {
  constructor(from, to, id) {
    super(`task ${id}: illegal transition ${from} -> ${to}`);
    this.from = from;
    this.to = to;
    this.id = id;
    this.name = "TaskStateError";
  }
}
export {
  TASK_LAST_ERROR_MAX_LENGTH,
  TASK_NOTIFY_TARGETS,
  TASK_USER_MESSAGE_MAX_LENGTH,
  TaskStateError,
  TaskValidationError
};
