import { resolveSlotId } from "../../llm/slot-manager.mjs";
import { LINK_GENERATOR_GRAMMAR } from "./link-generator-grammar.mjs";
import { LINK_GENERATOR_RESPONSE_FORMAT } from "./link-generator-response-format.mjs";
import {
  buildLinkGeneratorPrompt
} from "./link-generator-prompt.mjs";
import {
  parseLinkGeneratorOutput
} from "./link-generator-parser.mjs";
import { LinkValidationError } from "../../../memory/links/link-store.mjs";
function createLinkGeneratorRunner(deps) {
  const now = deps.now ?? Date.now;
  const pending = /* @__PURE__ */ new Map();
  const maxLinksPerCall = deps.maxLinksPerCall ?? 4;
  const minCandidates = deps.minCandidates ?? 2;
  const finish = (outcome, context) => {
    const tookMs = Math.max(0, now() - context.startedAt);
    deps.metrics?.recordLinkGenerator({
      sessionId: context.sessionId,
      outcome,
      durationMs: tookMs,
      ...typeof context.linksWritten === "number" ? { linksWritten: context.linksWritten } : {}
    });
    if (deps.emitTrace) {
      try {
        deps.emitTrace({
          sessionId: context.sessionId,
          outcome,
          ...typeof context.linksWritten === "number" ? { linksWritten: context.linksWritten } : {},
          ...context.reason ? { reason: context.reason } : {}
        });
      } catch {
      }
    }
    const logContext = {
      sessionId: context.sessionId,
      tookMs,
      ...typeof context.linksWritten === "number" ? { linksWritten: context.linksWritten } : {},
      ...context.reason ? { reason: context.reason } : {}
    };
    switch (outcome) {
      case "ok":
        deps.logger?.info("link_generator.ok", logContext);
        return;
      case "none":
        deps.logger?.debug("link_generator.none", logContext);
        return;
      case "skipped":
        deps.logger?.debug("link_generator.skipped", logContext);
        return;
      case "aborted":
        deps.logger?.debug("link_generator.aborted", logContext);
        return;
      case "timeout":
        deps.logger?.warn("link_generator.timeout", logContext);
        return;
      case "failed":
        deps.logger?.warn("link_generator.failed", logContext);
        return;
    }
  };
  const runOne = async (input) => {
    if (input.candidates.length < minCandidates) {
      finish("skipped", {
        sessionId: input.sessionId,
        startedAt: now(),
        reason: `candidates=${input.candidates.length} < minCandidates=${minCandidates}`
      });
      return 0;
    }
    const previous = pending.get(input.sessionId);
    if (previous) previous.abort();
    const controller = new AbortController();
    pending.set(input.sessionId, controller);
    const startedAt = now();
    deps.logger?.debug("link_generator.fired", {
      sessionId: input.sessionId,
      candidates: input.candidates.length
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deps.timeoutMs);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      timer.unref?.();
    }
    try {
      const prompt = buildLinkGeneratorPrompt({
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        candidates: input.candidates
      });
      const completion = await deps.llmComplete({
        prompt,
        grammar: LINK_GENERATOR_GRAMMAR,
        responseFormat: LINK_GENERATOR_RESPONSE_FORMAT,
        slotId: resolveSlotId(deps.reflectionSlotId),
        sessionId: `link-gen:${input.sessionId}`,
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        finish(timedOut ? "timeout" : "aborted", {
          sessionId: input.sessionId,
          startedAt
        });
        return 0;
      }
      const allowlist = new Set(input.candidates.map((c) => c.id));
      const parsed = parseLinkGeneratorOutput(completion.content, {
        allowlist,
        maxLinks: maxLinksPerCall
      });
      if (parsed.kind === "none") {
        finish("none", { sessionId: input.sessionId, startedAt });
        return 0;
      }
      const linksWritten = writeLinks(
        parsed.links,
        deps.linkStore,
        input.sessionId,
        deps.logger
      );
      if (linksWritten === 0) {
        finish("none", { sessionId: input.sessionId, startedAt });
        return 0;
      }
      finish("ok", {
        sessionId: input.sessionId,
        startedAt,
        linksWritten
      });
      return linksWritten;
    } catch (err) {
      if (controller.signal.aborted) {
        finish(timedOut ? "timeout" : "aborted", {
          sessionId: input.sessionId,
          startedAt
        });
        return 0;
      }
      const reason = err instanceof Error ? err.message : String(err);
      finish("failed", { sessionId: input.sessionId, startedAt, reason });
      return 0;
    } finally {
      clearTimeout(timer);
      if (pending.get(input.sessionId) === controller) {
        pending.delete(input.sessionId);
      }
    }
  };
  return {
    async generate(input) {
      try {
        return await runOne(input);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("link_generator.failed", {
          sessionId: input.sessionId,
          tookMs: 0,
          reason
        });
        return 0;
      }
    },
    abortPending(options) {
      if (options?.sessionId !== void 0) {
        const target = pending.get(options.sessionId);
        if (target) target.abort();
        return;
      }
      for (const controller of pending.values()) controller.abort();
    }
  };
}
function writeLinks(links, store, sessionId, logger) {
  let written = 0;
  for (const link of links) {
    try {
      store.add({
        fromId: link.fromId,
        toId: link.toId,
        kind: link.kind
      });
      written += 1;
    } catch (err) {
      if (err instanceof LinkValidationError) {
        logger?.debug("link_generator.invalid_link", {
          sessionId,
          field: err.field,
          reason: err.message
        });
        continue;
      }
      throw err;
    }
  }
  return written;
}
export {
  createLinkGeneratorRunner
};
