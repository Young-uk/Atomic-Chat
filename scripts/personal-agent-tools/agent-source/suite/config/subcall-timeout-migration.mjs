const HOSTED_SUBCALL_TIMEOUTS_VERSION = 65;
const PRE_V65_SUBCALL_TIMEOUT_DEFAULTS = {
  reflectionTimeoutMs: 1e4,
  linkGeneratorTimeoutMs: 8e3,
  rewriterTimeoutMs: 3e3
};
function resolveSubcallTimeoutMs(inputVersion, value, previousDefault, currentDefault) {
  if (inputVersion < HOSTED_SUBCALL_TIMEOUTS_VERSION && value === previousDefault) {
    return currentDefault;
  }
  return value;
}
export {
  HOSTED_SUBCALL_TIMEOUTS_VERSION,
  PRE_V65_SUBCALL_TIMEOUT_DEFAULTS,
  resolveSubcallTimeoutMs
};
