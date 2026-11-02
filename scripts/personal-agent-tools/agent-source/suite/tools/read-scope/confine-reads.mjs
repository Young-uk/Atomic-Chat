import { isFusionWorkerSessionId } from "../../session/fusion-worker-session.mjs";
import {
  checkWorkerRead,
  findSessionReadOutside,
  workerReadRefusal
} from "./read-scope.mjs";
import {
  ReadOutsideApprover,
  readOutsidePrompt,
  shellReadOutsidePrompt
} from "./read-scope-approval.mjs";
import {
  findShellPathOutsideScope,
  shellCommandLine
} from "./read-scope-shell.mjs";
import { READ_TOOL_TARGETS, SHELL_TOOL } from "./read-scope-targets.mjs";
import {
  findShellStateSecrets,
  findStateSecretReads,
  stateSecretReadPrompt,
  stateSecretShellPrompt
} from "./state-secrets.mjs";
const CONFINED = /* @__PURE__ */ new WeakSet();
function confineReads(registry, options) {
  if (options.readScope !== void 0 && options.approvals === void 0) {
    throw new Error(
      "confineReads: a session read scope asks through the approval ladder; pass `approvals` with `readScope`"
    );
  }
  if (options.stateSecrets !== void 0 && options.approvals === void 0) {
    throw new Error(
      "confineReads: the secret-file guard asks through the approval ladder; pass `approvals` with `stateSecrets`"
    );
  }
  const asker = options.approvals === void 0 ? null : new ReadOutsideApprover(options.approvals);
  const secrets = options.stateSecrets ?? null;
  const confined = [];
  const scoped = () => options.readScope?.() === "working-dir";
  const install = (name, run) => {
    const inner = registry.get(name);
    confined.push(name);
    if (CONFINED.has(inner)) return;
    const wrapped = { ...inner, run };
    CONFINED.add(wrapped);
    registry.register(wrapped);
  };
  for (const name of READ_TOOL_TARGETS.keys()) {
    if (!registry.has(name)) continue;
    const inner = registry.get(name);
    install(name, async (args, ctx) => {
      const worker = checkWorkerRead(
        name,
        args,
        ctx,
        options.grantedDirs(ctx.sessionId)
      );
      if (worker !== null) return worker;
      const secretPaths = asker === null || secrets === null ? [] : findStateSecretReads(name, args, ctx, secrets);
      if (asker !== null && secretPaths.length > 0) {
        await asker.confirmStateSecret(
          name,
          ctx,
          { reason: stateSecretReadPrompt(secretPaths) },
          secretPaths
        );
      }
      if (asker === null || !scoped()) return inner.run(args, ctx);
      const refusal = await asker.admit(
        name,
        ctx,
        (roots) => findSessionReadOutside(name, args, ctx, [...roots, ...secretPaths]),
        (path, root) => readOutsidePrompt(path, ctx.workingDir, root)
      );
      return refusal ?? inner.run(args, ctx);
    });
  }
  if (asker !== null && registry.has(SHELL_TOOL)) {
    const inner = registry.get(SHELL_TOOL);
    install(SHELL_TOOL, async (args, ctx) => {
      const secretPaths = secrets === null ? [] : findShellStateSecrets(args, ctx, secrets, options.shellEnv);
      if (secretPaths.length > 0) {
        const commandLine = shellCommandLine(args);
        await asker.confirmStateSecret(
          SHELL_TOOL,
          ctx,
          {
            reason: stateSecretShellPrompt(commandLine, secretPaths),
            preview: commandLine
          },
          secretPaths
        );
      }
      if (!scoped()) return inner.run(args, ctx);
      if (isFusionWorkerSessionId(ctx.sessionId)) {
        const granted = options.grantedDirs(ctx.sessionId);
        const outside = findShellPathOutsideScope(
          args,
          ctx,
          [ctx.workingDir, ...granted, ...secretPaths],
          options.shellEnv
        );
        return outside === null ? inner.run(args, ctx) : workerReadRefusal(SHELL_TOOL, outside, ctx, granted);
      }
      const refusal = await asker.admit(
        SHELL_TOOL,
        ctx,
        (roots) => findShellPathOutsideScope(
          args,
          ctx,
          [...roots, ...secretPaths],
          options.shellEnv
        ),
        (path, root) => shellReadOutsidePrompt(
          shellCommandLine(args),
          path,
          ctx.workingDir,
          root
        )
      );
      return refusal ?? inner.run(args, ctx);
    });
  }
  return confined;
}
function confineWorkerReads(registry, options) {
  return confineReads(registry, { grantedDirs: options.grantedDirs });
}
export {
  confineReads,
  confineWorkerReads
};
