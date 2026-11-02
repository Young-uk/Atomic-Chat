import { MemoryValidationError } from "../memory-store.mjs";
import { ProfileValidationError } from "../profile-store.mjs";
import {
  isNameProfileKey
} from "../profile-name-keys.mjs";
import { REFLECTION_GRAMMAR } from "./reflection-grammar.mjs";
import { parseReflectionOutput } from "./reflection-parser.mjs";
import { buildCloudSubcallRequest } from "../../llm/provider/cloud-subcall.mjs";
import { resolveSlotId } from "../../llm/slot-manager.mjs";
import { buildReflectionPrompt } from "./reflection-prompt.mjs";
import {
  filterUngroundedReflection,
  isTrivialReflectionWindow,
  nameGroundingIn
} from "./reflection-grounding.mjs";
import { groundingTextsOf } from "../name-grounding.mjs";
import { findDuplicateFact } from "../profile-duplicates.mjs";
const REFLECTION_EMIT_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "string",
      description: "Reflection output: NONE or newline-separated SET/NOTE/EVOLVE lines"
    }
  },
  required: ["lines"],
  additionalProperties: false
};
function createReflectionRunner(deps) {
  const now = deps.now ?? Date.now;
  const pending = /* @__PURE__ */ new Map();
  const finish = (outcome, context) => {
    const tookMs = Math.max(0, now() - context.startedAt);
    deps.metrics?.recordReflection({
      sessionId: context.sessionId,
      outcome,
      durationMs: tookMs
    });
    if (deps.emitTrace) {
      try {
        deps.emitTrace({
          sessionId: context.sessionId,
          outcome,
          ...typeof context.factsWritten === "number" ? { factsWritten: context.factsWritten } : {},
          ...typeof context.notesWritten === "number" ? { notesWritten: context.notesWritten } : {},
          ...context.reason ? { reason: context.reason } : {}
        });
      } catch {
      }
    }
    const logContext = {
      sessionId: context.sessionId,
      tookMs,
      ...typeof context.factsWritten === "number" ? { factsWritten: context.factsWritten } : {},
      ...typeof context.notesWritten === "number" ? { notesWritten: context.notesWritten } : {},
      ...context.reason ? { reason: context.reason } : {}
    };
    switch (outcome) {
      case "ok":
        deps.logger?.info("reflection.ok", logContext);
        return;
      case "none":
        deps.logger?.debug("reflection.none", logContext);
        return;
      case "aborted":
        deps.logger?.debug("reflection.aborted", logContext);
        return;
      case "timeout":
        deps.logger?.warn("reflection.timeout", logContext);
        return;
      case "failed":
        deps.logger?.warn("reflection.failed", logContext);
        return;
    }
  };
  const runOne = async (input) => {
    const userTexts = reflectedUserTexts(input);
    if (!deps.anySpeaker && isTrivialReflectionWindow(userTexts)) {
      finish("none", {
        sessionId: input.sessionId,
        startedAt: now(),
        reason: "trivial_window"
      });
      return;
    }
    const previous = pending.get(input.sessionId);
    if (previous) {
      previous.abort();
    }
    const controller = new AbortController();
    pending.set(input.sessionId, controller);
    const startedAt = now();
    deps.logger?.debug("reflection.fired", { sessionId: input.sessionId });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deps.timeoutMs);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      timer.unref?.();
    }
    try {
      const prompt = buildReflectionPrompt({
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        ...deps.typedNotes ? { typedNotes: true } : {},
        ...deps.anySpeaker ? { anySpeaker: true } : {},
        // v2.5 (Phase B). When the agent loop
        // hands a multi-turn transcript window, the prompt renders
        // it instead of the single trailing pair.
        ...input.transcript && input.transcript.length > 0 ? { transcript: input.transcript } : {},
        // ATO-188. What the profile already says, so the model reuses a
        // key instead of writing the same fact under a new one. Not in
        // any-speaker mode, whose keys name third parties.
        ...deps.anySpeaker ? {} : { knownProfile: knownProfileOf(deps.profileStore) }
      });
      const completion = deps.toolTransport === "native_tools" ? await deps.llmComplete({
        ...buildCloudSubcallRequest({
          prompt,
          emitFunctionName: "emit_reflection",
          argsSchema: REFLECTION_EMIT_SCHEMA,
          sessionId: `reflection:${input.sessionId}`
        }),
        grammar: "",
        slotId: -1,
        sessionId: `reflection:${input.sessionId}`,
        ...input.modelModePolicy ? { modelModePolicy: input.modelModePolicy } : {},
        signal: controller.signal
      }) : await deps.llmComplete({
        prompt,
        grammar: REFLECTION_GRAMMAR,
        slotId: resolveSlotId(deps.reflectionSlotId),
        sessionId: `reflection:${input.sessionId}`,
        ...input.modelModePolicy ? { modelModePolicy: input.modelModePolicy } : {},
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        finish(timedOut ? "timeout" : "aborted", {
          sessionId: input.sessionId,
          startedAt
        });
        return;
      }
      const rawText = deps.toolTransport === "native_tools" ? extractCloudSubcallText(completion) : completion.content;
      const parsed = parseReflectionOutput(rawText);
      if (parsed.kind === "none") {
        finish("none", { sessionId: input.sessionId, startedAt });
        return;
      }
      const nameEvidence = reflectedNameEvidence(input, deps.profileStore);
      const grounded = filterUngroundedReflection(parsed, {
        userTexts,
        nameEvidence
      });
      for (const item of grounded.dropped) {
        deps.logger?.info("reflection.ungrounded_dropped", {
          sessionId: input.sessionId,
          kind: item.kind,
          reason: item.reason,
          detail: DROP_REASON_DETAIL[item.reason],
          chars: item.text.length
        });
      }
      const factsWritten = writeFacts(
        grounded.facts,
        deps.profileStore,
        deps.maxFactsPerCall,
        input.sessionId,
        deps.logger,
        [...userTexts, ...nameEvidence]
      );
      const notesWritten = writeNotes(
        grounded.notes,
        deps.memoryStore,
        deps.maxNotesPerCall ?? 0,
        input.sessionId,
        deps.logger
      );
      const evolvesApplied = applyEvolves(
        parsed.evolves,
        deps.neighborEvolver,
        input
      );
      if (factsWritten === 0 && notesWritten === 0 && evolvesApplied === 0) {
        finish("none", {
          sessionId: input.sessionId,
          startedAt,
          ...grounded.dropped.length > 0 ? { reason: `ungrounded_dropped=${grounded.dropped.length}` } : {}
        });
        return;
      }
      finish("ok", {
        sessionId: input.sessionId,
        startedAt,
        factsWritten,
        notesWritten
      });
    } catch (err) {
      if (controller.signal.aborted) {
        finish(timedOut ? "timeout" : "aborted", {
          sessionId: input.sessionId,
          startedAt
        });
        return;
      }
      const reason = err instanceof Error ? err.message : String(err);
      finish("failed", { sessionId: input.sessionId, startedAt, reason });
    } finally {
      clearTimeout(timer);
      if (pending.get(input.sessionId) === controller) {
        pending.delete(input.sessionId);
      }
    }
  };
  return {
    async reflect(input) {
      try {
        await runOne(input);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("reflection.failed", {
          sessionId: input.sessionId,
          tookMs: 0,
          reason
        });
      }
    },
    abortPending(options) {
      if (options?.sessionId !== void 0) {
        const target = pending.get(options.sessionId);
        if (target) target.abort();
        return;
      }
      for (const controller of pending.values()) {
        controller.abort();
      }
    }
  };
}
function knownProfileOf(store) {
  try {
    return store.listForPrompt().map((f) => ({ key: f.key, value: f.value }));
  } catch {
    return [];
  }
}
const DROP_REASON_DETAIL = {
  ungrounded_identity: "names the user by a name the user never wrote",
  assistant_persona: "describes the assistant, not the user",
  one_off_payload: "repeats a one-off reply instruction",
  one_off_tool_restriction: "turns a one-off 'no tools' into a preference"
};
function reflectedNameEvidence(input, profileStore) {
  const out = [...input.groundingTexts ?? []];
  if (input.transcript && input.transcript.length > 0) {
    const lines = [];
    for (const turn of input.transcript) {
      lines.push({ kind: "user", text: turn.user });
      lines.push({ kind: "assistant_reply", text: turn.assistant });
    }
    out.push(...groundingTextsOf(lines));
  }
  try {
    for (const fact of profileStore.list()) {
      if (isNameProfileKey(fact.key) && fact.nameGrounding === "grounded") {
        out.push(fact.value);
      }
    }
  } catch {
  }
  return out;
}
function reflectedUserTexts(input) {
  if (input.transcript && input.transcript.length > 0) {
    return input.transcript.map((turn) => turn.user);
  }
  return [input.userMessage];
}
function writeFacts(facts, store, maxPerCall, sessionId, logger, userTexts) {
  const clamped = facts.slice(0, maxPerCall);
  let written = 0;
  for (const fact of clamped) {
    try {
      const opts = {
        pinned: fact.pinned,
        keywords: [...fact.keywords]
      };
      const nameGrounding = isNameProfileKey(fact.key) ? nameGroundingIn(fact.value, userTexts) : void 0;
      if (nameGrounding !== void 0) {
        opts.nameGrounding = nameGrounding;
      }
      const duplicate = findDuplicateFact(store.list(), fact.key, fact.value);
      if (duplicate !== null && (duplicate.kind === "same" || !fact.supersedes)) {
        const confirmed = (duplicate.kind === "same" || isNameProfileKey(duplicate.fact.key)) && nameGrounding === "grounded" && duplicate.fact.nameGrounding !== "grounded" && store.markNameGrounding(duplicate.fact.id, "grounded");
        logger?.debug("reflection.duplicate_fact", {
          sessionId,
          kind: duplicate.kind,
          ...confirmed ? { confirmed: true } : {}
        });
        if (confirmed) written += 1;
        continue;
      }
      if (typeof fact.supersedes === "string" && fact.supersedes.length > 0) {
        opts.supersedesKey = fact.supersedes;
      }
      store.set(fact.key, fact.value, opts);
      written += 1;
    } catch (err) {
      if (err instanceof ProfileValidationError) {
        logger?.debug("reflection.invalid_fact", {
          sessionId,
          key: fact.key,
          reason: err.message
        });
        continue;
      }
      throw err;
    }
  }
  return written;
}
function writeNotes(notes, store, maxPerCall, sessionId, logger) {
  if (!store || maxPerCall <= 0 || notes.length === 0) return 0;
  const clamped = notes.slice(0, maxPerCall);
  let written = 0;
  for (const note of clamped) {
    try {
      const tags = dedupeTags(["reflection", ...note.tags]);
      store.store({
        content: note.body,
        tags,
        sessionId,
        source: "agent"
      });
      written += 1;
    } catch (err) {
      if (err instanceof MemoryValidationError) {
        logger?.debug("reflection.invalid_note", {
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
function extractCloudSubcallText(completion) {
  const tc = completion.toolCalls?.[0];
  if (!tc?.function?.arguments) return completion.content;
  try {
    const parsed = JSON.parse(tc.function.arguments);
    if (typeof parsed.lines === "string") return parsed.lines;
  } catch {
  }
  return completion.content;
}
function dedupeTags(tags) {
  const out = [];
  for (const tag of tags) {
    if (tag.length === 0) continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}
function applyEvolves(evolves, evolver, input) {
  if (!evolver || evolves.length === 0) return 0;
  const allowlist = input.recalledMemoryIds && input.recalledMemoryIds.length > 0 ? new Set(input.recalledMemoryIds) : void 0;
  const report = evolver.apply({
    sessionId: input.sessionId,
    evolves,
    ...allowlist ? { allowlist } : {}
  });
  return report.applied;
}
export {
  createReflectionRunner
};
