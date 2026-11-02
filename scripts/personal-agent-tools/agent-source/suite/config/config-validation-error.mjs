class ConfigValidationError extends Error {
  constructor(field, reason) {
    super(`invalid config: ${field}: ${reason}`);
    this.field = field;
    this.reason = reason;
    this.name = "ConfigValidationError";
  }
}
export {
  ConfigValidationError
};
