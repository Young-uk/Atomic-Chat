import { resolveSlotId } from "../../llm/slot-manager.mjs";
import {
  DISTILL_GRAMMAR,
  DISTILL_WITH_PROCEDURE_GRAMMAR
} from "./distill-grammar.mjs";
import {
  DISTILL_RESPONSE_FORMAT,
  DISTILL_WITH_PROCEDURE_RESPONSE_FORMAT
} from "./distill-response-format.mjs";
import {
  DistillParseError,
  parseDistillOutput,
  parseDistillWithProcedureOutput
} from "./distill-parser.mjs";
import { buildDistillPrompt } from "./distill-prompt.mjs";
class DistillRunner {
  constructor(deps) {
    this.deps = deps;
  }
  async distill(request) {
    const clusterSize = request.episodes.length;
    const emit = (outcome, extra) => {
      if (!this.deps.emitTrace) return;
      try {
        this.deps.emitTrace({
          sessionId: request.sessionId,
          outcome,
          clusterSize,
          ...extra?.hasProcedure !== void 0 ? { hasProcedure: extra.hasProcedure } : {},
          ...extra?.reason ? { reason: extra.reason } : {}
        });
      } catch {
      }
    };
    if (clusterSize === 0) {
      emit("failed", { reason: "empty_cluster" });
      return { kind: "failed", reason: "empty_cluster" };
    }
    if (request.signal.aborted) {
      emit("aborted");
      return { kind: "aborted" };
    }
    const withProcedure = this.deps.withProcedure === true;
    const prompt = buildDistillPrompt({
      episodes: request.episodes,
      sharedTags: request.sharedTags,
      withProcedure
    });
    const grammar = withProcedure ? DISTILL_WITH_PROCEDURE_GRAMMAR : DISTILL_GRAMMAR;
    const responseFormat = withProcedure ? DISTILL_WITH_PROCEDURE_RESPONSE_FORMAT : DISTILL_RESPONSE_FORMAT;
    const innerCtrl = new AbortController();
    const onAbort = () => innerCtrl.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => innerCtrl.abort(), this.deps.timeoutMs);
    const startedAt = Date.now();
    try {
      const result = await this.deps.llmComplete({
        prompt,
        grammar,
        responseFormat,
        slotId: resolveSlotId(this.deps.slotId),
        sessionId: request.sessionId,
        signal: innerCtrl.signal
      });
      const elapsed = Date.now() - startedAt;
      this.deps.metrics?.recordConsolidationDistillLatency(elapsed);
      const rawContent = result.content ?? "";
      const parsed = withProcedure ? parseDistillWithProcedureOutput(rawContent) : parseDistillOutput(rawContent);
      if (parsed.kind === "none") {
        this.deps.logger?.info?.("consolidator.distill.none", {
          sessionId: request.sessionId,
          parentIds: request.episodes.map((e) => e.id)
        });
        emit("none");
        return { kind: "none" };
      }
      const procedure = withProcedure && "procedure" in parsed ? parsed.procedure ?? null : null;
      this.deps.logger?.info?.("consolidator.distill.ok", {
        sessionId: request.sessionId,
        parentIds: request.episodes.map((e) => e.id),
        elapsedMs: elapsed,
        hasProcedure: procedure !== null
      });
      emit("ok", { hasProcedure: procedure !== null });
      return {
        kind: "ok",
        lesson: {
          kind: "lesson",
          activation: parsed.activation,
          principle: parsed.principle,
          tags: parsed.tags
        },
        procedure
      };
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      this.deps.metrics?.recordConsolidationDistillLatency(elapsed);
      if (request.signal.aborted) {
        this.deps.logger?.warn?.("consolidator.distill.aborted", {
          sessionId: request.sessionId
        });
        emit("aborted");
        return { kind: "aborted" };
      }
      if (innerCtrl.signal.aborted) {
        this.deps.logger?.warn?.("consolidator.distill.timeout", {
          sessionId: request.sessionId,
          timeoutMs: this.deps.timeoutMs
        });
        emit("timeout");
        return { kind: "timeout" };
      }
      const reason = err instanceof DistillParseError ? `parse:${err.reason}` : err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn?.("consolidator.distill.failed", {
        sessionId: request.sessionId,
        reason
      });
      emit("failed", { reason });
      return { kind: "failed", reason };
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
    }
  }
}
export {
  DistillRunner
};
