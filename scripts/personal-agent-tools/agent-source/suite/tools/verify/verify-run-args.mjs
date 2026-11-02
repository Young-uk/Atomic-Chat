const VERIFY_RUN_DEFAULT_TIMEOUT_MS = 12e4;
const VERIFY_RUN_MAX_TIMEOUT_MS = 9e5;
const VERIFY_READY_DEFAULT_TIMEOUT_MS = 3e4;
const VERIFY_PAGE_DEFAULT_SECONDS = 5;
const VERIFY_PAGE_MAX_SECONDS = 120;
const MAX_REQUESTS = 32;
const MAX_SCRIPT_STEPS = 64;
const MAX_PROBES = 16;
const MAX_CHECKS = 32;
const KINDS = /* @__PURE__ */ new Set(["command", "service", "page"]);
const ACTIONS = /* @__PURE__ */ new Set(["click", "key", "type", "wait"]);
function fail(message) {
  throw new Error(`verify.run: ${message}`);
}
function optionalString(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "string") fail(`\`${field}\` must be a string`);
  return raw;
}
function optionalNonEmptyString(raw, field) {
  const value = optionalString(raw, field);
  return value === "" ? void 0 : value;
}
function requiredString(raw, field) {
  const value = optionalString(raw, field);
  if (value === void 0 || value.trim().length === 0) {
    fail(`\`${field}\` must be a non-empty string`);
  }
  return value;
}
function optionalStringArray(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    fail(`\`${field}\` must be an array of strings`);
  }
  return raw;
}
function clampedNumber(raw, field, fallback, max) {
  if (raw === void 0 || raw === null) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    fail(`\`${field}\` must be a positive number`);
  }
  return Math.min(raw, max);
}
function optionalInteger(raw, field) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    fail(`\`${field}\` must be an integer`);
  }
  return raw;
}
function readyPort(raw) {
  const port = optionalInteger(raw, "ready.port");
  return port === 0 ? void 0 : port;
}
function startGiven(raw) {
  if (raw === void 0 || raw === null) return false;
  if (typeof raw !== "object" || Array.isArray(raw)) return true;
  const { cmd, args } = raw;
  const blankCmd = cmd === void 0 || cmd === null || typeof cmd === "string" && cmd.trim() === "";
  const noArgs = args === void 0 || args === null || Array.isArray(args) && args.length === 0;
  return !(blankCmd && noArgs);
}
function record(raw, field) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(`\`${field}\` must be an object`);
  }
  return raw;
}
function list(raw, field, max) {
  if (!Array.isArray(raw)) fail(`\`${field}\` must be an array`);
  if (raw.length > max) fail(`\`${field}\` has ${raw.length} entries; at most ${max}`);
  return raw;
}
function parseEnv(raw) {
  if (raw === void 0 || raw === null) return void 0;
  const env = record(raw, "env");
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") fail(`\`env.${key}\` must be a string`);
  }
  return env;
}
function parseRequests(raw) {
  if (raw === void 0 || raw === null) return void 0;
  return list(raw, "requests", MAX_REQUESTS).map((entry, i) => {
    const r = record(entry, `requests[${i}]`);
    let path = optionalString(r.path, `requests[${i}].path`);
    let url = optionalString(r.url, `requests[${i}].url`);
    if (path === "" && url) path = void 0;
    if (url === "" && path) url = void 0;
    if (path === void 0 === (url === void 0)) {
      fail(`requests[${i}] needs exactly one of \`path\` or \`url\``);
    }
    return {
      method: optionalString(r.method, `requests[${i}].method`),
      path,
      url,
      body: typeof r.body === "string" || r.body === void 0 || r.body === null ? r.body ?? void 0 : JSON.stringify(r.body),
      expectStatus: optionalInteger(r.expectStatus, `requests[${i}].expectStatus`),
      expectBody: optionalString(r.expectBody, `requests[${i}].expectBody`)
    };
  });
}
function parseScript(raw) {
  if (raw === void 0 || raw === null) return void 0;
  return list(raw, "script", MAX_SCRIPT_STEPS).map((entry, i) => {
    const s = record(entry, `script[${i}]`);
    const action = requiredString(s.action, `script[${i}].action`);
    if (!ACTIONS.has(action)) {
      fail(`script[${i}].action must be one of click, key, type, wait`);
    }
    const step = {
      action,
      selector: optionalString(s.selector, `script[${i}].selector`),
      key: optionalString(s.key, `script[${i}].key`),
      text: optionalString(s.text, `script[${i}].text`),
      ms: typeof s.ms === "number" ? s.ms : void 0
    };
    if (action === "click" && step.selector === void 0) fail(`script[${i}] click needs \`selector\``);
    if (action === "key" && step.key === void 0) fail(`script[${i}] key needs \`key\``);
    if (action === "type" && step.text === void 0) fail(`script[${i}] type needs \`text\``);
    if (action === "wait" && step.ms === void 0) fail(`script[${i}] wait needs \`ms\``);
    return step;
  });
}
function parseProbes(raw) {
  if (raw === void 0 || raw === null) return void 0;
  return list(raw, "probes", MAX_PROBES).map((entry, i) => {
    const p = record(entry, `probes[${i}]`);
    return {
      name: requiredString(p.name, `probes[${i}].name`),
      expr: requiredString(p.expr, `probes[${i}].expr`)
    };
  });
}
function parseVerifyRunArgs(raw) {
  const kind = requiredString(raw.kind, "kind");
  if (!KINDS.has(kind)) fail("`kind` must be one of command, service, page");
  const base = {
    kind,
    cwd: optionalString(raw.cwd, "cwd"),
    env: parseEnv(raw.env),
    timeoutMs: clampedNumber(raw.timeoutMs, "timeoutMs", VERIFY_RUN_DEFAULT_TIMEOUT_MS, VERIFY_RUN_MAX_TIMEOUT_MS),
    network: raw.network === true,
    seconds: clampedNumber(raw.seconds, "seconds", VERIFY_PAGE_DEFAULT_SECONDS, VERIFY_PAGE_MAX_SECONDS),
    checks: raw.checks === void 0 || raw.checks === null ? void 0 : list(raw.checks, "checks", MAX_CHECKS).map((c, i) => requiredString(c, `checks[${i}]`))
  };
  if (kind === "command") {
    return { ...base, cmd: requiredString(raw.cmd, "cmd"), args: optionalStringArray(raw.args, "args") ?? [] };
  }
  if (kind === "service") {
    const start2 = record(raw.start, "start");
    const ready2 = raw.ready === void 0 || raw.ready === null ? {} : record(raw.ready, "ready");
    const port2 = readyPort(ready2.port);
    const url2 = optionalNonEmptyString(ready2.url, "ready.url");
    if (port2 === void 0 && url2 === void 0) fail("service needs `ready.port` or `ready.url`");
    return {
      ...base,
      start: { cmd: requiredString(start2.cmd, "start.cmd"), args: optionalStringArray(start2.args, "start.args") ?? [] },
      ready: { port: port2, url: url2, timeoutMs: clampedNumber(ready2.timeoutMs, "ready.timeoutMs", VERIFY_READY_DEFAULT_TIMEOUT_MS, VERIFY_RUN_MAX_TIMEOUT_MS) },
      requests: parseRequests(raw.requests) ?? []
    };
  }
  const path = optionalNonEmptyString(raw.path, "path");
  const url = optionalNonEmptyString(raw.url, "url");
  if (path === void 0 === (url === void 0)) fail("page needs exactly one of `path` or `url`");
  const page = { ...base, path, url, script: parseScript(raw.script) ?? [], probes: parseProbes(raw.probes) ?? [] };
  if (!startGiven(raw.start)) return page;
  if (url === void 0) fail("page with `start` needs `url` (the address the started server serves), not `path`");
  const start = record(raw.start, "start");
  const ready = raw.ready === void 0 || raw.ready === null ? {} : record(raw.ready, "ready");
  const port = readyPort(ready.port);
  const readyUrl = optionalNonEmptyString(ready.url, "ready.url");
  return {
    ...page,
    start: { cmd: requiredString(start.cmd, "start.cmd"), args: optionalStringArray(start.args, "start.args") ?? [] },
    ready: {
      port,
      // Default readiness: the page URL itself answers 2xx.
      url: readyUrl ?? (port === void 0 ? url : void 0),
      timeoutMs: clampedNumber(ready.timeoutMs, "ready.timeoutMs", VERIFY_READY_DEFAULT_TIMEOUT_MS, VERIFY_RUN_MAX_TIMEOUT_MS)
    }
  };
}
export {
  VERIFY_PAGE_DEFAULT_SECONDS,
  VERIFY_PAGE_MAX_SECONDS,
  VERIFY_READY_DEFAULT_TIMEOUT_MS,
  VERIFY_RUN_DEFAULT_TIMEOUT_MS,
  VERIFY_RUN_MAX_TIMEOUT_MS,
  parseVerifyRunArgs
};
