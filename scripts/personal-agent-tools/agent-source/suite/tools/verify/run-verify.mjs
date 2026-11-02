import { resolve, relative, isAbsolute } from "node:path";
import { getConfig } from "../../config/index.mjs";
import { runCommandKind } from "./run-command-kind.mjs";
import { defaultBrowserLauncher, runPageKind } from "./run-page-kind.mjs";
import { runServiceKind } from "./run-service-kind.mjs";
import { evaluateChecks } from "./verify-checks.mjs";
import { parseVerifyRunArgs } from "./verify-run-args.mjs";
import { renderVerifyRunSummary } from "./verify-run-summary.mjs";
import { terminalAppHint } from "./terminal-app-hint.mjs";
import { createVerifyWorkspace } from "./verify-workspace-copy.mjs";
function resolveRunCwd(root, cwd) {
  if (cwd === void 0) return root;
  const target = resolve(root, cwd);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`verify.run: \`cwd\` must stay inside the working directory (got ${cwd})`);
  }
  return target;
}
function finish(base, subject, specs, runOk, started) {
  const checks = specs === void 0 || specs.length === 0 ? void 0 : base.error !== void 0 ? specs.map((check) => ({ check, ok: false, detail: `not evaluated: ${base.error}` })) : evaluateChecks(specs, subject);
  const ok = runOk && (checks?.every((c) => c.ok) ?? true);
  const withoutSummary = { ...base, ok, durationMs: Date.now() - started, ...checks === void 0 ? {} : { checks } };
  return { ...withoutSummary, summary: renderVerifyRunSummary({ ...withoutSummary, summary: "" }) };
}
async function runInWorkspace(args, dir, isolated, ctx, started) {
  const cwd = resolveRunCwd(dir, args.cwd);
  const common = { kind: args.kind, isolated };
  if (args.kind === "command") {
    const out = await runCommandKind(args, { cwd, signal: ctx.signal });
    const runOk = out.spawnError === void 0 && !out.timedOut && out.exitCode === 0;
    const hint = runOk ? void 0 : terminalAppHint(out.stdout, out.stderr);
    return finish(
      { ...common, ...hint === void 0 ? {} : { hint }, commandLine: out.commandLine, exitCode: out.exitCode, timedOut: out.timedOut, stdoutTail: out.stdoutTail, stderrTail: out.stderrTail, ...out.spawnError === void 0 ? {} : { error: `could not start \`${out.commandLine}\`: ${out.spawnError}` } },
      { kind: "command", exitCode: out.exitCode, timedOut: out.timedOut, stdout: out.stdout, stderr: out.stderr },
      args.checks,
      runOk,
      started
    );
  }
  if (args.kind === "service") {
    const out = await runServiceKind(args, { cwd, signal: ctx.signal, fetchImpl: ctx.fetchImpl });
    const runOk = out.ready && out.requests.every((q) => q.ok);
    return finish(
      { ...common, commandLine: out.commandLine, exitCode: out.exitCode, timedOut: out.timedOut, ready: out.ready, readyMs: out.readyMs, requests: out.requests, stdoutTail: out.stdoutTail, stderrTail: out.stderrTail, ...out.readyError === void 0 ? {} : { error: out.readyError } },
      { kind: "service", exitCode: out.exitCode, timedOut: out.timedOut, stdout: out.stdout, stderr: out.stderr, requests: out.requests },
      args.checks,
      runOk,
      started
    );
  }
  const launch = ctx.launchBrowser ?? defaultBrowserLauncher(ctx.config ?? { browser: getConfig().browser });
  if (args.start === void 0) {
    const out = await runPageKind(args, { cwd, signal: ctx.signal, launch });
    return finishPage(common, out, {}, args, started);
  }
  const held = {};
  const server = await runServiceKind(args, {
    cwd,
    signal: ctx.signal,
    fetchImpl: ctx.fetchImpl,
    whileReady: async () => {
      held.page = await runPageKind(args, { cwd, signal: ctx.signal, launch });
    }
  });
  const serverFields = {
    commandLine: server.commandLine,
    exitCode: server.exitCode,
    timedOut: server.timedOut,
    ready: server.ready,
    readyMs: server.readyMs,
    stdoutTail: server.stdoutTail,
    stderrTail: server.stderrTail
  };
  const page = held.page;
  if (page === void 0) {
    const error = server.readyError ?? "the page server was not ready";
    return finish(
      { ...common, ...serverFields, error: `page server: ${error}` },
      { kind: "page", errors: [], consoleErrors: [], missingSelectors: [], probes: {} },
      args.checks,
      false,
      started
    );
  }
  return finishPage(common, page, serverFields, args, started);
}
function finishPage(common, out, extra, args, started) {
  const runOk = out.launched && out.loaded && out.errors.length === 0 && out.consoleErrors.length === 0;
  return finish(
    { ...common, ...extra, errors: out.errors, consoleErrors: out.consoleErrors, consoleWarnings: out.consoleWarnings, requestFailures: out.requestFailures, missingSelectors: out.missingSelectors, probes: out.probes, ...out.error === void 0 ? {} : { error: out.error } },
    { kind: "page", errors: out.errors, consoleErrors: out.consoleErrors, missingSelectors: out.missingSelectors, probes: out.probes },
    args.checks,
    runOk,
    started
  );
}
async function runVerify(rawArgs, ctx) {
  const started = Date.now();
  const args = parseVerifyRunArgs(rawArgs);
  const workspace = await (ctx.workspace ?? createVerifyWorkspace)(ctx.workingDir);
  try {
    return await runInWorkspace(args, workspace.dir, workspace.isolated, ctx, started);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const base = { kind: args.kind, isolated: workspace.isolated, error };
    return finish(base, { kind: args.kind }, args.checks, false, started);
  } finally {
    await workspace.cleanup();
  }
}
async function runChecks(specs, ctx) {
  const results = [];
  for (const spec of specs) {
    if (ctx.signal?.aborted) break;
    try {
      results.push(await runVerify(spec, ctx));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const kind = typeof spec.kind === "string" ? spec.kind : "command";
      results.push({ ok: false, kind, isolated: true, durationMs: 0, error, summary: `verify.run ${kind}: FAILED
${error}` });
    }
  }
  return { ok: results.length === specs.length && results.every((r) => r.ok), results };
}
export {
  runChecks,
  runVerify
};
