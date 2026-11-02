import { requireApproval } from "../../approval/dangerous-tool.mjs";
import { runVerify } from "./run-verify.mjs";
import { parseVerifyRunArgs } from "./verify-run-args.mjs";
const VERIFY_RUN_TOOL = "verify.run";
function describeVerifyRun(args) {
  if (args.kind === "command") return [args.cmd, ...args.args ?? []].join(" ");
  if (args.kind === "service") {
    const start = [args.start?.cmd, ...args.start?.args ?? []].join(" ");
    return `start \`${start}\`, then ${args.requests?.length ?? 0} request(s)`;
  }
  const open = `open ${args.url ?? args.path} headless for ${args.seconds}s`;
  if (args.start === void 0) return open;
  return `start \`${[args.start.cmd, ...args.start.args ?? []].join(" ")}\`, then ${open}`;
}
function buildVerifyRunTool(options) {
  return {
    name: VERIFY_RUN_TOOL,
    description: "Run a check against a throwaway copy of the working directory \u2014 nothing it writes reaches the workspace (may require approval). kind 'command': any test runner, compiler or script ({cmd, args}). kind 'service': {start:{cmd,args}, ready:{port|url}, requests:[{method,path|url,body,expectStatus,expectBody}]}. kind 'page': a local HTML file ({path}) or {url} in a headless browser (with {start, url} the server is started first and the page opens once `ready` passes, by default when the url answers 2xx): {script:[{action:click|key|type|wait,\u2026}]}, then `seconds` of runtime with `probes:[{name, expr}]` sampled every 250 ms; collects uncaught errors, console errors, failed getElementById/querySelector lookups. `checks`: `exit 0`, `exit != 0`, `stdout contains \"x\"`, `stderr not contains \"x\"`, `status 200`, `no errors`, `missing selectors 0`, `probe <name> decreases|increases|equals <v>|reaches <v>|stays <v>`. `network` defaults to false (a proxy-based soft block, not a sandbox). Results are capped: output tails of 8,000 chars, summary of 4,000.",
    readonly: true,
    async run(rawArgs, ctx) {
      let args;
      try {
        args = parseVerifyRunArgs(rawArgs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { tool: VERIFY_RUN_TOOL, status: "error", summary: message, details: { error: message }, truncated: false };
      }
      const description = describeVerifyRun(args);
      const scopedByFanout = options.approvals.fanoutScopes?.allows(ctx.sessionId, [ctx.workingDir]) ?? false;
      if (!scopedByFanout) {
        await requireApproval(
          options,
          {
            sessionId: ctx.sessionId,
            tool: VERIFY_RUN_TOOL,
            category: "shell",
            reason: `verify (${args.kind}) in a throwaway copy of ${ctx.workingDir}`,
            preview: description,
            affectedResources: [ctx.workingDir]
          },
          ctx.signal
        );
      }
      const result = await runVerify(args, {
        workingDir: ctx.workingDir,
        config: options.config,
        signal: ctx.signal,
        ...options.launchBrowser === void 0 ? {} : { launchBrowser: options.launchBrowser }
      });
      const { summary, ...details } = result;
      return {
        tool: VERIFY_RUN_TOOL,
        status: result.ok ? "ok" : "error",
        summary,
        details: { ...details, description },
        truncated: summary.endsWith("[clipped]")
      };
    }
  };
}
export {
  VERIFY_RUN_TOOL,
  buildVerifyRunTool,
  describeVerifyRun
};
