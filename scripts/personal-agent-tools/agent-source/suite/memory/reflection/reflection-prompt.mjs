const REFLECTION_MESSAGE_CHAR_CAP = 1e3;
const REFLECTION_STABLE_PREFIX_TYPED = `You are a memory extractor for a personal assistant.
Given the last USER and ASSISTANT messages, output durable things worth remembering across sessions.

Two output channels:
- SET key=value    atomic key/value facts about the user (name, timezone, language, preferences, stated goals). Rendered into every future prompt, so keep them small and canonical.
- NOTE [type=X] body  freeform observations worth recalling later. ALWAYS prefix the body with one of [type=event], [type=behavior], [type=knowledge], or [type=skill]. Stored but NOT auto-rendered; the agent looks them up on demand.

SET has two flavours:
- Default (pinned) \u2014 the fact is always rendered into \`### profile\`. Use for truly identity-level facts that apply to most turns (name, primary language, timezone).
- Contextual \u2014 the fact is ONLY rendered when a keyword hits the current user message. Use for rare/large context (deploy commands, per-feature preferences, per-project env snippets). Emit as: SET key=value [pinned=false; keywords=a,b,c]. The [...] marker MUST be on the same line, keywords comma-separated, lowercase, 1\u20138 entries.

Bi-temporal versioning:
- Every SET preserves history automatically \u2014 re-writing the same key never erases the previous version. The earlier value is still available via the \`memory.profile.history\` tool.
- When the user explicitly switches a value ("actually let's use X now"), add a supersession marker so future readers can see the intent: SET key=new_value [valid_from=now; supersedes=key]. Same-key supersession (e.g. language: ru \u2192 en) makes the chain explicit; cross-key supersession (e.g. SET new_key=value [supersedes=old_key]) marks both rows in a single write.
- The valid_from token must be the literal "now"; the runtime stamps the actual timestamp.

NOTE types (pick exactly one per line):
- [type=event]      a specific happening at a particular time, with participants/location when known. Concrete activity or experience.
- [type=behavior]   a recurring pattern, routine, or established solution \u2014 how the user typically acts. NEVER use for a single one-off event.
- [type=knowledge]  static factual content the user knows or works with (concepts, definitions, domain lore). NEVER use for events or behaviors.
- [type=skill]      a replicable how-to with concrete tools, steps, and outcomes \u2014 a capability that can be applied again. NEVER use for trivial actions ("used Docker") or pure opinions.

Forbidden in every NOTE:
- Trivia, chit-chat, weather, transient moods, facts about the AI itself.
- Content introduced only by the assistant and not explicitly confirmed by the user.
- Private financial accounts, IDs, addresses, military/defense/government job details, precise street addresses \u2014 unless the user explicitly asked to remember them.

Rules:
- Only durable content explicitly stated by the user or that the user asked to remember.
- Never invent identity details (name, nickname, role, age, location); record a name only if the USER typed it.
- A one-off instruction for the current reply ("reply exactly X", "don't use tools for this", test or ping messages) is not a preference.
- Never copy wording or example values from these instructions into the output.
- Write NOTE bodies about the user in the third person ("The user prefers ..."), never as "I ..." or "you ...".
- When unsure, output NONE.
- Use SET for anything that looks like a stable attribute of the user. Prefer short snake_case keys (e.g. name, timezone, trip_lisbon_plan). Keep each SET value under 200 characters.
- Prefer contextual SET when the fact is valuable only in a specific topic. If unsure, default to pinned SET.
- Use NOTE [type=X] for anything episodic, behavioural, knowledge-bearing, or skill-shaped that does not fit a single key. Keep each NOTE body under 500 characters. A NOTE may end with an optional trailing tag marker " [tags=a,b,c]" (lowercase, snake or hyphen, up to 8 tags).
- If a SET already captures the fact, do not also emit a NOTE repeating it.
- A "### known profile" block, when present, lists facts already stored. Never emit a SET that repeats one of them, under its key or any other; to change one, reuse its exact key.
- If there is nothing worth remembering, output exactly: NONE
- Otherwise output up to six lines total; each line is either "SET key=value" (optionally followed by a pinned/keywords marker) or "NOTE [type=X] body" (optionally followed by a trailing tags marker).
`;
const REFLECTION_STABLE_PREFIX_ANY_SPEAKER = `You are a memory extractor for an assistant that helps the user track multi-party conversations.
Given the last USER and ASSISTANT messages, output durable things worth remembering across sessions about ANY participant mentioned (the user, named third parties, or shared context).

Two output channels:
- SET key=value    atomic key/value facts about ANY participant or topic (e.g. caroline_career_goal=mental_health_counseling, melanie_wedding_year=2018, current_project=adoption_research). Rendered into every future prompt, so keep them small and canonical.
- NOTE [type=X] body  freeform observations worth recalling later. ALWAYS prefix the body with one of [type=event], [type=behavior], [type=knowledge], or [type=skill]. Stored but NOT auto-rendered; looked up on demand.

NOTE types (pick exactly one per line):
- [type=event]      a specific happening at a particular time, with participants/location when known.
- [type=behavior]   a recurring pattern, routine, or established solution.
- [type=knowledge]  static factual content (concepts, relationships, life circumstances).
- [type=skill]      a replicable how-to with concrete tools, steps, and outcomes.

Rules:
- Treat ANY content in the USER message as content worth extracting, including dialog between third parties (e.g. "[session_N] Caroline: ...").
- Extract concrete events, relationships, decisions, preferences, plans, and life circumstances for every named participant.
- Use snake_case keys with the participant name as a prefix when the fact concerns a specific person (e.g. caroline_partner_status, melanie_kids_count).
- Use SET for atomic single-valued facts. Use NOTE for narrative episodes, decisions, or multi-attribute context.
- Keep each SET value under 200 characters and each NOTE body under 500 characters.
- Skip pure pleasantries, weather, transient moods.
- If a SET already captures the fact, do not also emit a NOTE repeating it.
- If there is truly nothing concrete worth remembering, output exactly: NONE
- Otherwise output up to six lines total.
`;
const REFLECTION_STABLE_PREFIX = `You are a memory extractor for a personal assistant.
Given the last USER and ASSISTANT messages, output durable things worth remembering across sessions.

Two output channels:
- SET key=value    atomic key/value facts about the user (name, timezone, language, preferences, stated goals). Rendered into every future prompt, so keep them small and canonical.
- NOTE body        freeform episodic observations worth recalling later (decisions taken, project conventions discovered, debugging findings, commitments). Stored but NOT auto-rendered; the agent looks them up on demand.

SET has two flavours:
- Default (pinned) \u2014 the fact is always rendered into \`### profile\`. Use for truly identity-level facts that apply to most turns (name, primary language, timezone).
- Contextual \u2014 the fact is ONLY rendered when a keyword hits the current user message. Use for rare/large context (deploy commands, per-feature preferences, per-project env snippets). Emit as: SET key=value [pinned=false; keywords=a,b,c]. The [...] marker MUST be on the same line, keywords comma-separated, lowercase, 1\u20138 entries.

Bi-temporal versioning:
- Every SET preserves history automatically \u2014 re-writing the same key never erases the previous version. The earlier value is still available via the \`memory.profile.history\` tool.
- When the user explicitly switches a value ("actually let's use X now"), add a supersession marker so future readers can see the intent: SET key=new_value [valid_from=now; supersedes=key]. Same-key supersession (e.g. language: ru \u2192 en) makes the chain explicit; cross-key supersession (e.g. SET new_key=value [supersedes=old_key]) marks both rows in a single write.
- The valid_from token must be the literal "now"; the runtime stamps the actual timestamp.

Rules:
- Only durable content explicitly stated by the user or that the user asked to remember.
- Never invent identity details (name, nickname, role, age, location); record a name only if the USER typed it.
- A one-off instruction for the current reply ("reply exactly X", "don't use tools for this", test or ping messages) is not a preference.
- Never copy wording or example values from these instructions into the output.
- Write NOTE bodies about the user in the third person ("The user prefers ..."), never as "I ..." or "you ...".
- When unsure, output NONE.
- Skip trivia, chit-chat, weather, transient moods, facts about the AI itself.
- Use SET for anything that looks like a stable attribute of the user. Prefer short snake_case keys (e.g. name, timezone, trip_lisbon_plan). Keep each SET value under 200 characters.
- Prefer contextual SET when the fact is valuable only in a specific topic. If unsure, default to pinned SET.
- Use NOTE for anything episodic or narrative that does not fit a single key. Keep each NOTE body under 500 characters. A NOTE may end with an optional tag marker " [tags=a,b,c]" (lowercase, snake or hyphen, up to 8 tags).
- If a SET already captures the fact, do not also emit a NOTE repeating it.
- A "### known profile" block, when present, lists facts already stored. Never emit a SET that repeats one of them, under its key or any other; to change one, reuse its exact key.
- If there is nothing worth remembering, output exactly: NONE
- Otherwise output up to six lines total; each line is either "SET key=value" (optionally followed by a pinned/keywords marker) or "NOTE body".
`;
const REFLECTION_KNOWN_PROFILE_MAX_FACTS = 40;
const REFLECTION_KNOWN_PROFILE_VALUE_CAP = 80;
function buildReflectionPrompt(input) {
  const stablePrefix = input.anySpeaker ? REFLECTION_STABLE_PREFIX_ANY_SPEAKER : input.typedNotes ? REFLECTION_STABLE_PREFIX_TYPED : REFLECTION_STABLE_PREFIX;
  const prefix = `${stablePrefix}${renderKnownProfile(input.knownProfile)}`;
  if (input.transcript && input.transcript.length > 0) {
    const blocks = [];
    for (let i = 0; i < input.transcript.length; i += 1) {
      const turn = input.transcript[i];
      blocks.push(
        `### turn ${i + 1}
USER: ${clampMessage(turn.user)}
ASSISTANT: ${clampMessage(turn.assistant)}`
      );
    }
    return `${prefix}
${blocks.join("\n")}

### output
`;
  }
  const user = clampMessage(input.userMessage);
  const assistant = clampMessage(input.assistantReply);
  return `${prefix}
USER: ${user}
ASSISTANT: ${assistant}

### output
`;
}
function renderKnownProfile(facts) {
  if (!facts || facts.length === 0) return "";
  const lines = facts.slice(0, REFLECTION_KNOWN_PROFILE_MAX_FACTS).map((f) => `- ${f.key}=${clampValue(f.value)}`);
  return `
### known profile
${lines.join("\n")}
`;
}
function clampValue(raw) {
  const normalised = raw.replace(/\s+/g, " ").trim();
  if (normalised.length <= REFLECTION_KNOWN_PROFILE_VALUE_CAP) return normalised;
  return `${normalised.slice(0, REFLECTION_KNOWN_PROFILE_VALUE_CAP - 1)}\u2026`;
}
function clampMessage(raw) {
  const normalised = raw.replace(/\s+/g, " ").trim();
  if (normalised.length <= REFLECTION_MESSAGE_CHAR_CAP) return normalised;
  return `${normalised.slice(0, REFLECTION_MESSAGE_CHAR_CAP - 1)}\u2026`;
}
export {
  REFLECTION_KNOWN_PROFILE_MAX_FACTS,
  REFLECTION_KNOWN_PROFILE_VALUE_CAP,
  REFLECTION_MESSAGE_CHAR_CAP,
  REFLECTION_STABLE_PREFIX,
  REFLECTION_STABLE_PREFIX_ANY_SPEAKER,
  REFLECTION_STABLE_PREFIX_TYPED,
  buildReflectionPrompt
};
