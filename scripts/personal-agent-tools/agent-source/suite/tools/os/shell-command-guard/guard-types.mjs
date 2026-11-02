class ShellGuardBlockError extends Error {
  constructor(rule, reason) {
    super(`shell guard blocked: ${rule} - ${reason}`);
    this.rule = rule;
    this.reason = reason;
    this.name = "ShellGuardBlockError";
  }
}
export {
  ShellGuardBlockError
};
