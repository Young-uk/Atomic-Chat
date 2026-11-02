import { statSync } from "node:fs";
import { dirname } from "node:path";
import {
  ApprovalDeniedError,
  requireApproval
} from "../../approval/dangerous-tool.mjs";
import {
  sessionReadDeclined,
  sessionReadRefusal,
  sessionReadRoots
} from "./read-scope.mjs";
function widenedReadRoot(path) {
  try {
    if (statSync(path).isDirectory()) return path;
  } catch {
  }
  return dirname(path);
}
const consequence = (root) => `approving allows reads under ${root} for the rest of this session`;
function readOutsidePrompt(path, workingDir, root) {
  return {
    reason: `read ${path} \u2014 outside the working directory (${workingDir}); ${consequence(root)}`
  };
}
function shellReadOutsidePrompt(commandLine, path, workingDir, root) {
  return {
    reason: `run \`${commandLine}\` \u2014 reads outside the working directory (${workingDir}): ${path}; ${consequence(root)}`,
    preview: commandLine
  };
}
class SessionQueue {
  tails = /* @__PURE__ */ new Map();
  run(sessionId, task) {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => void 0,
      () => void 0
    );
    this.tails.set(sessionId, tail);
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return result;
  }
}
class ReadOutsideApprover {
  constructor(options) {
    this.options = options;
  }
  queue = new SessionQueue();
  /** Working directory, user-named paths, and the directories approved so far. */
  roots(ctx) {
    return [
      ...sessionReadRoots(ctx),
      ...this.options.approvals.readScopeGrants.rootsFor(ctx.sessionId)
    ];
  }
  /**
   * Let `tool`'s call through, or not. `outsideOf(roots)` names the
   * first path the call reaches outside `roots` (or `null`); when there
   * is one, the operator is asked with `promptFor(path, root)`. Resolves
   * `null` when the call may run (nothing outside, or approved — and
   * then `root` is remembered), or the refusal when it was denied.
   */
  admit(tool, ctx, outsideOf, promptFor) {
    return this.queue.run(ctx.sessionId, async () => {
      const roots = this.roots(ctx);
      const path = outsideOf(roots);
      if (path === null) return null;
      const root = widenedReadRoot(path);
      const prompt = promptFor(path, root);
      try {
        await requireApproval(
          this.options,
          {
            sessionId: ctx.sessionId,
            tool,
            category: "fs_read_outside",
            reason: prompt.reason,
            ...prompt.preview !== void 0 ? { preview: prompt.preview } : {},
            affectedResources: [root]
          },
          ctx.signal
        );
      } catch (err) {
        if (err instanceof ApprovalDeniedError) {
          return err.byUser || err.declinedEarlier ? sessionReadDeclined(tool, path, roots, err.message) : sessionReadRefusal(tool, path, ctx, roots);
        }
        throw err;
      }
      this.options.approvals.readScopeGrants.widen(ctx.sessionId, root);
      return null;
    });
  }
  /**
   * Ask about a call that touches the agent's own secret files
   * (`state-secrets.ts`) as `state_secret`, in the same per-session queue
   * as the scope question so a batch never shows two prompts at once.
   * Resolves when approved; a denial throws `ApprovalDeniedError`, as
   * every gated tool's does. Nothing is remembered: the category is never
   * granted, and no read root is widened by the answer.
   */
  confirmStateSecret(tool, ctx, prompt, paths) {
    return this.queue.run(ctx.sessionId, async () => {
      await requireApproval(
        this.options,
        {
          sessionId: ctx.sessionId,
          tool,
          category: "state_secret",
          reason: prompt.reason,
          ...prompt.preview !== void 0 ? { preview: prompt.preview } : {},
          affectedResources: [...paths]
        },
        ctx.signal
      );
    });
  }
}
export {
  ReadOutsideApprover,
  readOutsidePrompt,
  shellReadOutsidePrompt,
  widenedReadRoot
};
