import { spawnVerifyProcess } from "./spawn-verify-process.mjs";
async function runCommandKind(args, ctx) {
  const started = Date.now();
  const proc = spawnVerifyProcess(args.cmd ?? "", args.args ?? [], {
    cwd: ctx.cwd,
    env: args.env,
    network: args.network,
    timeoutMs: args.timeoutMs,
    signal: ctx.signal
  });
  const exit = await proc.exited;
  return {
    commandLine: proc.commandLine,
    exitCode: exit.exitCode,
    signal: exit.signal,
    timedOut: exit.timedOut,
    aborted: exit.aborted,
    ...exit.spawnError === void 0 ? {} : { spawnError: exit.spawnError },
    stdout: proc.stdout.all(),
    stderr: proc.stderr.all(),
    stdoutTail: proc.stdout.tail(),
    stderrTail: proc.stderr.tail(),
    durationMs: Date.now() - started
  };
}
export {
  runCommandKind
};
