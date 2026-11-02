import net from "node:net";
import { spawnVerifyProcess } from "./spawn-verify-process.mjs";
const READY_POLL_MS = 250;
const REQUEST_TIMEOUT_MS = 1e4;
const BODY_HEAD_CHARS = 500;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1e3, () => done(false));
  });
}
async function urlAnswers(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(2e3) });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}
async function waitForReady(proc, ready, fetchImpl) {
  const started = Date.now();
  let exited = false;
  void proc.exited.then(() => {
    exited = true;
  });
  while (Date.now() - started < ready.timeoutMs) {
    if (exited) {
      return { ready: false, readyMs: null, error: "the process exited before it was ready" };
    }
    const open = ready.url !== void 0 ? await urlAnswers(ready.url, fetchImpl) : ready.port !== void 0 && await portOpen(ready.port);
    if (open) return { ready: true, readyMs: Date.now() - started };
    await sleep(READY_POLL_MS);
  }
  return {
    ready: false,
    readyMs: null,
    error: `not ready after ${ready.timeoutMs} ms (${ready.url ?? `port ${ready.port}`})`
  };
}
function baseUrlFor(ready) {
  if (ready.url !== void 0) return new URL(ready.url).origin;
  return `http://127.0.0.1:${ready.port}`;
}
async function sendRequest(spec, baseUrl, fetchImpl) {
  const method = (spec.method ?? "GET").toUpperCase();
  const url = spec.url ?? new URL(spec.path ?? "/", `${baseUrl}/`).href;
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method,
      ...spec.body === void 0 ? {} : { body: spec.body, headers: { "content-type": "application/json" } },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = await res.text();
    const statusOk = spec.expectStatus === void 0 ? res.status >= 200 && res.status < 300 : res.status === spec.expectStatus;
    const bodyOk = spec.expectBody === void 0 || body.includes(spec.expectBody);
    return {
      method,
      url,
      status: res.status,
      ok: statusOk && bodyOk,
      bodyHead: body.slice(0, BODY_HEAD_CHARS),
      ms: Date.now() - started,
      ...bodyOk ? {} : { error: `body does not contain ${JSON.stringify(spec.expectBody)}` }
    };
  } catch (err) {
    return {
      method,
      url,
      status: null,
      ok: false,
      bodyHead: "",
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function runServiceKind(args, ctx) {
  const started = Date.now();
  const fetchImpl = ctx.fetchImpl ?? ((url, init) => fetch(url, init));
  const start = args.start ?? { cmd: "", args: [] };
  const ready = args.ready ?? { timeoutMs: 0 };
  const proc = spawnVerifyProcess(start.cmd, start.args ?? [], {
    cwd: ctx.cwd,
    env: args.env,
    network: args.network,
    timeoutMs: args.timeoutMs,
    signal: ctx.signal
  });
  const requests = [];
  let readiness;
  try {
    readiness = await waitForReady(proc, ready, fetchImpl);
    if (readiness.ready) {
      const baseUrl = baseUrlFor(ready);
      for (const spec of args.requests ?? []) {
        if (ctx.signal?.aborted) break;
        requests.push(await sendRequest(spec, baseUrl, fetchImpl));
      }
      if (ctx.whileReady !== void 0 && !ctx.signal?.aborted) await ctx.whileReady();
    }
  } finally {
    proc.killGroup();
  }
  const exit = await proc.exited;
  return {
    commandLine: proc.commandLine,
    ready: readiness.ready,
    readyMs: readiness.readyMs,
    ...readiness.error === void 0 ? {} : { readyError: readiness.error },
    requests,
    exitCode: exit.exitCode,
    timedOut: exit.timedOut,
    stdout: proc.stdout.all(),
    stderr: proc.stderr.all(),
    stdoutTail: proc.stdout.tail(),
    stderrTail: proc.stderr.tail(),
    durationMs: Date.now() - started
  };
}
export {
  runServiceKind
};
