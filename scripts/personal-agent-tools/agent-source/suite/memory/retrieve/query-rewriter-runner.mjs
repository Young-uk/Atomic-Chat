import { resolveSlotId } from "../../llm/slot-manager.mjs";
import { QUERY_REWRITER_GRAMMAR } from "./query-rewriter-grammar.mjs";
import { QUERY_REWRITER_RESPONSE_FORMAT } from "./query-rewriter-response-format.mjs";
import {
  buildRewriterPrompt
} from "./query-rewriter-prompt.mjs";
import { parseRewriterOutput } from "./query-rewriter-parser.mjs";
import { createHeuristicGate } from "./rewriter-gate.mjs";
const REWRITER_SLOT_ID = -1;
function createQueryRewriterRunner(deps) {
  const now = deps.now ?? (() => Date.now());
  const gate = deps.gate ?? createHeuristicGate();
  return {
    async maybeRewrite(input) {
      const startedAt = now();
      const raw = input.userMessage;
      if (input.history.length === 0) {
        record("skipped_no_history", startedAt, input.sessionId);
        return raw;
      }
      const referential = await gate.check({
        message: raw,
        historyTurnCount: input.history.length,
        signal: input.signal
      });
      if (!referential) {
        record("skipped_not_referential", startedAt, input.sessionId);
        return raw;
      }
      if (input.signal.aborted) {
        record("aborted", startedAt, input.sessionId);
        return raw;
      }
      const prompt = buildRewriterPrompt({
        history: input.history,
        currentMessage: raw
      });
      const ac = new AbortController();
      const onCallerAbort = () => ac.abort();
      input.signal.addEventListener("abort", onCallerAbort, { once: true });
      let timer = null;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new TimeoutMarker());
        }, deps.timeoutMs);
      });
      try {
        const completion = await Promise.race([
          deps.llmComplete({
            prompt,
            grammar: QUERY_REWRITER_GRAMMAR,
            responseFormat: QUERY_REWRITER_RESPONSE_FORMAT,
            slotId: deps.slotId === void 0 ? REWRITER_SLOT_ID : resolveSlotId(deps.slotId),
            // Own fallback partition, like `reflection:` / `vote:`. The
            // chain partitions breaker state by this id; on the bare id a
            // provider refusing the rewriter's request flipped the TURN's
            // sticky override, and the next main step went to the next
            // link (often a local server that is not running).
            sessionId: `rewriter:${input.sessionId}`,
            signal: ac.signal
          }),
          timeoutPromise
        ]);
        const rewritten = parseRewriterOutput(completion.content);
        if (rewritten === null) {
          record(
            "failed",
            startedAt,
            input.sessionId,
            "the model's rewrite could not be parsed"
          );
          return raw;
        }
        deps.logger?.debug?.("rewriter.ok", {
          sessionId: input.sessionId,
          originalLength: raw.length,
          rewrittenLength: rewritten.length
        });
        record("ok", startedAt, input.sessionId);
        return rewritten;
      } catch (err) {
        if (err instanceof TimeoutMarker) {
          record("timeout", startedAt, input.sessionId);
          return raw;
        }
        if (input.signal.aborted) {
          record("aborted", startedAt, input.sessionId);
          return raw;
        }
        const reason = err instanceof Error ? err.message : String(err);
        deps.logger?.warn?.("rewriter.failed", {
          sessionId: input.sessionId,
          error: reason
        });
        record("failed", startedAt, input.sessionId, reason);
        return raw;
      } finally {
        if (timer) clearTimeout(timer);
        input.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  };
  function record(outcome, startedAt, sessionId, reason) {
    deps.metrics?.recordRetrieveRewriter?.({
      outcome,
      durationMs: now() - startedAt
    });
    if (deps.emitTrace) {
      try {
        deps.emitTrace({ sessionId, outcome, ...reason ? { reason } : {} });
      } catch {
      }
    }
  }
}
class TimeoutMarker extends Error {
  constructor() {
    super("query rewriter timed out");
    this.name = "TimeoutMarker";
  }
}
export {
  REWRITER_SLOT_ID,
  createQueryRewriterRunner
};
