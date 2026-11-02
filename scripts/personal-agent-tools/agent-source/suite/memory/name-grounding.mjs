import {
  countScriptLetters,
  isBareConfirmation,
  nameGroundingIn,
  namingQuestionsOf
} from "./reflection/reflection-grounding.mjs";
function chatLinesOf(turns) {
  const out = [];
  for (const turn of turns) {
    if (typeof turn.text !== "string") continue;
    if (turn.kind === "user") out.push({ kind: "user", text: turn.text });
    else if (turn.kind === "assistant_reply" && turn.progressNote !== true) {
      out.push({ kind: "assistant_reply", text: turn.text });
    }
  }
  return out;
}
function groundingTextsOf(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.kind !== "user") continue;
    out.push(line.text);
    const previous = i > 0 ? lines[i - 1] : null;
    if (previous?.kind === "assistant_reply" && isBareConfirmation(line.text)) {
      out.push(...namingQuestionsOf(previous.text));
    }
  }
  return out;
}
const SCAN_PAGE_SIZE = 50;
function sessionGroundingSource(sessions, pageSize = SCAN_PAGE_SIZE) {
  return async function* walk(options) {
    let after;
    for (; ; ) {
      const page = sessions.listSummaryPage({
        limit: pageSize,
        ...after !== void 0 ? { after } : {}
      });
      if (page.length === 0) return;
      for (const row of page) {
        if (options?.since !== void 0 && row.updatedAt <= options.since) return;
        yield {
          updatedAt: row.updatedAt,
          texts: groundingTextsOf(sessions.listChatLines(row.id))
        };
      }
      if (page.length < pageSize) return;
      const last = page[page.length - 1];
      after = { updatedAt: last.updatedAt, id: last.id };
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}
async function nameGroundingAcrossSessions(value, source) {
  const letters = { other: 0, comparable: 0 };
  for await (const conversation of source()) {
    if (groundedInConversation(value, conversation)) return "grounded";
    addLetters(letters, conversation);
  }
  return verdictOverAll(value, letters);
}
function groundedInConversation(value, conversation) {
  return nameGroundingIn(value, conversation.texts, { letters: COMPARABLE }) === "grounded";
}
const COMPARABLE = { other: 0, comparable: 1 };
function addLetters(into, conversation) {
  const counts = countScriptLetters(conversation.texts);
  into.other += counts.other;
  into.comparable += counts.comparable;
}
function verdictOverAll(value, letters) {
  const verdict = nameGroundingIn(value, [], { letters });
  return verdict === "grounded" ? "ungrounded" : verdict;
}
async function verifyProfileNameFacts(args) {
  const now = args.now ?? Date.now;
  const pending = args.store.listNameFactsToCheck();
  const report = {
    checked: 0,
    grounded: 0,
    ungrounded: 0,
    unverifiable: 0
  };
  if (pending.length === 0) return report;
  const startedAt = now();
  const open = pending.map((item) => ({
    ...item,
    grounded: false,
    letters: { other: 0, comparable: 0 }
  }));
  const since = open.some((item) => item.checkedAt === null) ? void 0 : Math.min(...open.map((item) => item.checkedAt ?? 0));
  for await (const conversation of args.source(
    since !== void 0 ? { since } : {}
  )) {
    for (const item of open) {
      if (item.grounded) continue;
      if (item.checkedAt !== null && conversation.updatedAt <= item.checkedAt) {
        continue;
      }
      if (groundedInConversation(item.fact.value, conversation)) {
        item.grounded = true;
      } else {
        addLetters(item.letters, conversation);
      }
    }
    if (open.every((item) => item.grounded)) break;
  }
  for (const item of open) {
    const verdict = item.grounded ? "grounded" : item.checkedAt !== null ? "ungrounded" : verdictOverAll(item.fact.value, item.letters);
    if (!args.store.markNameGrounding(item.fact.id, verdict, startedAt, {
      ifUnconfirmed: true
    })) {
      continue;
    }
    report.checked += 1;
    report[verdict] += 1;
  }
  args.logger?.info("profile name facts checked against the user's messages", {
    checked: report.checked,
    grounded: report.grounded,
    ungrounded: report.ungrounded,
    unverifiable: report.unverifiable
  });
  return report;
}
export {
  chatLinesOf,
  groundingTextsOf,
  nameGroundingAcrossSessions,
  sessionGroundingSource,
  verifyProfileNameFacts
};
